import { NextResponse } from "next/server";
import { z } from "zod";

import {
  SandboxApiConfigurationError,
  getEffectiveSandboxApiSettings,
  runnerHostLabel,
  testSandboxApiConnection,
} from "@/lib/sandbox-api";
import {
  SETTINGS_COOKIE,
  clearSessionSettings,
  getSessionSettings,
  saveSessionSettings,
} from "@/lib/session-settings";

export const runtime = "nodejs";
export const maxDuration = 15;

const VERIFICATIONS_PER_MINUTE = 5;
type VerificationRate = { count: number; resetAt: number };
const processState = globalThis as typeof globalThis & {
  __flowlensSandboxApiVerificationRates?: Map<string, VerificationRate>;
};
const verificationRates = processState.__flowlensSandboxApiVerificationRates ??= new Map<string, VerificationRate>();

const requestSchema = z.object({
  apiKey: z.string().trim().min(20).max(512),
}).strict();

function jsonNoStore(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

function consumeVerificationAllowance(request: Request) {
  const now = Date.now();
  for (const [key, entry] of verificationRates) {
    if (entry.resetAt <= now) verificationRates.delete(key);
  }

  const sessionId = getSessionSettings(request)?.sessionId;
  const key = sessionId ? `session:${sessionId}` : "anonymous";
  const current = verificationRates.get(key);
  if (current && current.resetAt > now) {
    if (current.count >= VERIFICATIONS_PER_MINUTE) return false;
    current.count += 1;
    return true;
  }
  verificationRates.set(key, { count: 1, resetAt: now + 60_000 });
  return true;
}

function setSessionCookie(response: NextResponse, sessionId: string) {
  response.cookies.set({
    name: SETTINGS_COOKIE,
    value: sessionId,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });
}

function runnerResponse(request: Request) {
  const settings = getEffectiveSandboxApiSettings(request);
  return jsonNoStore({
    configured: Boolean(settings.apiKey),
    source: settings.source,
    host: settings.apiKey ? runnerHostLabel() : null,
    hasApiKey: Boolean(settings.apiKey),
  });
}

export async function GET(request: Request) {
  return runnerResponse(request);
}

export async function POST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return jsonNoStore({ error: "Send runner settings as JSON." }, { status: 415 });
    }
    if (!consumeVerificationAllowance(request)) {
      return jsonNoStore(
        { error: "Too many key checks. Try again in a minute." },
        { status: 429 },
      );
    }

    const body = requestSchema.parse(await request.json());
    const languages = await testSandboxApiConnection(body.apiKey);
    const sessionId = saveSessionSettings(request, { sandboxApiKey: body.apiKey });

    const response = jsonNoStore({
      configured: true,
      source: "session",
      host: runnerHostLabel(),
      hasApiKey: true,
      languages,
    });
    setSessionCookie(response, sessionId);
    return response;
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return jsonNoStore({ error: "Enter a valid SandboxAPI key." }, { status: 400 });
    }
    if (error instanceof SandboxApiConfigurationError) {
      return jsonNoStore({ error: error.message }, { status: 400 });
    }
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return jsonNoStore({ error: "SandboxAPI took too long to respond." }, { status: 504 });
    }
    console.error("SandboxAPI settings verification failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return jsonNoStore({ error: "The runner connection could not be verified." }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  const keepSessionCookie = clearSessionSettings(request, ["sandboxApiKey"]);
  const response = runnerResponse(request);
  if (!keepSessionCookie) {
    response.cookies.set({
      name: SETTINGS_COOKIE,
      value: "",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 0,
    });
  }
  return response;
}
