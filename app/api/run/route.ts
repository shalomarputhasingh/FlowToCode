import { NextResponse } from "next/server";
import { z } from "zod";

import {
  SandboxApiConfigurationError,
  getEffectiveSandboxApiSettings,
  getSandboxApiEndpoint,
  getSandboxApiHeaders,
  readJsonResponse,
} from "@/lib/sandbox-api";
import { getSessionSettings } from "@/lib/session-settings";

export const runtime = "nodejs";
export const maxDuration = 20;

const requestSchema = z.object({
  language: z.enum(["python", "c", "java"]),
  code: z.string().min(1).max(50000).refine((value) => value.trim().length > 0),
  stdin: z.string().max(10000).default(""),
}).strict();

const MAX_RUNNER_OUTPUT_CHARS = 100_000;
const MAX_RUNNER_RESPONSE_BYTES = 500_000;
const MAX_CONCURRENT_RUNS = 4;
const RUNS_PER_MINUTE = 20;

type RateEntry = { count: number; resetAt: number };
const processState = globalThis as typeof globalThis & {
  __flowlensRunnerState?: { active: number; rates: Map<string, RateEntry> };
};
const runnerState = processState.__flowlensRunnerState ??= { active: 0, rates: new Map() };

const runtimeConfig = {
  python: "python3",
  c: "c",
  java: "java",
} as const;

const JAVAC_ANNOTATION_PROCESSING_NOTICE = /Note:\s*Annotation processing is enabled because one or more processors were found\s*on the class path\.\s*A future release of javac may disable annotation processing\s*unless at least one processor is specified by name \(-processor\), or a search\s*path is specified \(--processor-path, --processor-module-path\), or annotation\s*processing is enabled explicitly \(-proc:only, -proc:full\)\.\s*Use -Xlint:-options to suppress this message\.\s*Use -proc:none to disable annotation processing\.\s*/gi;

const sandboxApiResponseSchema = z.object({
  status: z.enum(["completed", "error", "timeout"]),
  stdout: z.string().max(1_100_000).default(""),
  stderr: z.string().max(1_100_000).default(""),
  exit_code: z.number().int().nullable(),
  truncated: z.boolean().optional(),
}).passthrough();

const sandboxApiErrorSchema = z.object({
  message: z.string().max(2000).optional(),
  error: z.union([
    z.string().max(2000),
    z.object({ message: z.string().max(2000).optional() }).passthrough(),
  ]).optional(),
  detail: z.string().max(2000).optional(),
}).passthrough();

function jsonNoStore(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

function truncateOutput(output: string) {
  if (output.length <= MAX_RUNNER_OUTPUT_CHARS) {
    return { output, truncated: false };
  }
  return {
    output: `${output.slice(0, MAX_RUNNER_OUTPUT_CHARS)}\n\n[Output truncated]`,
    truncated: true,
  };
}

function cleanProviderStderr(language: keyof typeof runtimeConfig, stderr: string) {
  if (language !== "java") return stderr;
  return stderr.replace(JAVAC_ANNOTATION_PROCESSING_NOTICE, "");
}

function consumeRunAllowance(request: Request) {
  const now = Date.now();
  for (const [key, entry] of runnerState.rates) {
    if (entry.resetAt <= now) runnerState.rates.delete(key);
  }

  const sessionId = getSessionSettings(request)?.sessionId;
  const key = sessionId ? `session:${sessionId}` : "anonymous";
  const current = runnerState.rates.get(key);
  if (current && current.resetAt > now) {
    if (current.count >= RUNS_PER_MINUTE) return false;
    current.count += 1;
    return true;
  }
  runnerState.rates.set(key, { count: 1, resetAt: now + 60_000 });
  return true;
}

function getProviderError(payload: unknown, status: number) {
  const parsed = sandboxApiErrorSchema.safeParse(payload);
  if (!parsed.success) return `SandboxAPI returned HTTP ${status}.`;
  if (parsed.data.message) return parsed.data.message;
  if (parsed.data.detail) return parsed.data.detail;
  if (typeof parsed.data.error === "string") return parsed.data.error;
  if (parsed.data.error?.message) return parsed.data.error.message;
  return `SandboxAPI returned HTTP ${status}.`;
}

export async function POST(request: Request) {
  let acquiredRunnerSlot = false;
  try {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return jsonNoStore({ error: "Send the run request as JSON." }, { status: 415 });
    }

    const body = requestSchema.parse(await request.json());
    const runnerSettings = getEffectiveSandboxApiSettings(request);

    if (!runnerSettings.apiKey) {
      return jsonNoStore(
        { error: "Code runner is not configured. Add SandboxAPI in Settings and try again." },
        { status: 503 },
      );
    }

    if (!consumeRunAllowance(request)) {
      return jsonNoStore({ error: "Run limit reached. Try again in a minute." }, { status: 429 });
    }
    if (runnerState.active >= MAX_CONCURRENT_RUNS) {
      return jsonNoStore({ error: "The runner is busy. Try again shortly." }, { status: 503 });
    }
    runnerState.active += 1;
    acquiredRunnerSlot = true;

    const response = await fetch(getSandboxApiEndpoint("execute"), {
      method: "POST",
      headers: getSandboxApiHeaders(runnerSettings.apiKey),
      body: JSON.stringify({
        language: runtimeConfig[body.language],
        code: body.code,
        stdin: body.stdin,
        timeout: 10,
      }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
      redirect: "error",
    });

    const rawPayload = await readJsonResponse(response, MAX_RUNNER_RESPONSE_BYTES);
    if (!response.ok) {
      const providerMessage = getProviderError(rawPayload, response.status);
      if (response.status === 401 || response.status === 403) {
        throw new SandboxApiConfigurationError(
          "SandboxAPI rejected the saved key. Reconnect it in Settings.",
        );
      }
      if (response.status === 429) {
        throw new SandboxApiConfigurationError("SandboxAPI quota or rate limit reached.");
      }
      throw new Error(providerMessage);
    }

    const parsedPayload = sandboxApiResponseSchema.safeParse(rawPayload);
    if (!parsedPayload.success) {
      throw new Error("SandboxAPI returned an invalid execution response.");
    }
    const payload = parsedPayload.data;
    const stderr = cleanProviderStderr(body.language, payload.stderr);
    const rawOutput = payload.stdout && stderr
      ? `${payload.stdout}\n${stderr}`
      : payload.stdout || stderr;
    const outputResult = truncateOutput(rawOutput || "Program finished without output.");
    const status = payload.status === "timeout"
      ? "TIMEOUT"
      : payload.status === "completed" && payload.exit_code === 0
        ? "OK"
        : "ERROR";

    return jsonNoStore({
      output: outputResult.output,
      exitCode: payload.exit_code,
      status,
      signal: null,
      truncated: Boolean(payload.truncated || outputResult.truncated),
    });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return jsonNoStore({ error: "Choose a language and provide code to run." }, { status: 400 });
    }
    console.error("Code execution failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return jsonNoStore({ error: "The code runner took too long to respond." }, { status: 504 });
    }
    const message = error instanceof SandboxApiConfigurationError
      ? error.message
      : "The runner could not execute this program. Please try again.";
    const status = error instanceof SandboxApiConfigurationError ? 503 : 502;
    return jsonNoStore({ error: message }, { status });
  } finally {
    if (acquiredRunnerSlot) runnerState.active = Math.max(0, runnerState.active - 1);
  }
}
