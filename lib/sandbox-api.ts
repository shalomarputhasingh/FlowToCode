import "server-only";

import { z } from "zod";

import { getSessionSettings } from "@/lib/session-settings";

const SANDBOX_API_HOST = "sandboxapi.p.rapidapi.com";
const SANDBOX_API_BASE_URL = `https://${SANDBOX_API_HOST}/v1`;
const SANDBOX_API_TEST_TIMEOUT_MS = 10_000;
const MAX_LANGUAGE_RESPONSE_BYTES = 500_000;

const languageSchema = z.object({
  id: z.string().min(1).max(100).optional(),
  language: z.string().min(1).max(100).optional(),
  name: z.string().min(1).max(100).optional(),
  version: z.union([z.string().max(100), z.number().finite()]).optional(),
}).passthrough();

const languageListSchema = z.union([
  z.array(languageSchema).max(1000),
  z.object({ languages: z.array(languageSchema).max(1000) }).passthrough(),
]);

export type RunnerSource = "session" | "environment" | "none";

export class SandboxApiConfigurationError extends Error {
  constructor(message = "Code runner is not configured. Add SandboxAPI in Settings and try again.") {
    super(message);
    this.name = "SandboxApiConfigurationError";
  }
}

export function getSandboxApiEndpoint(operation: "execute" | "languages") {
  return `${SANDBOX_API_BASE_URL}/${operation}`;
}

export function getSandboxApiHeaders(apiKey: string) {
  return {
    "Content-Type": "application/json",
    "X-RapidAPI-Key": apiKey,
    "X-RapidAPI-Host": SANDBOX_API_HOST,
  };
}

export async function readJsonResponse(response: Response, maxBytes: number) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new SandboxApiConfigurationError("SandboxAPI returned an unexpectedly large response.");
  }

  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let body = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new SandboxApiConfigurationError("SandboxAPI returned an unexpectedly large response.");
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new SandboxApiConfigurationError("SandboxAPI returned an invalid response.");
  }
}

export function getEffectiveSandboxApiSettings(request: Request) {
  const sessionApiKey = getSessionSettings(request)?.settings.sandboxApiKey?.trim();
  if (sessionApiKey) {
    return { apiKey: sessionApiKey, source: "session" as const };
  }

  const environmentApiKey = process.env.SANDBOXAPI_KEY?.trim();
  if (environmentApiKey) {
    return { apiKey: environmentApiKey, source: "environment" as const };
  }

  return { apiKey: null, source: "none" as const };
}

export function runnerHostLabel() {
  return SANDBOX_API_HOST;
}

export async function testSandboxApiConnection(apiKey: string) {
  const response = await fetch(getSandboxApiEndpoint("languages"), {
    headers: getSandboxApiHeaders(apiKey),
    signal: AbortSignal.timeout(SANDBOX_API_TEST_TIMEOUT_MS),
    cache: "no-store",
    redirect: "error",
  });

  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401 || response.status === 403) {
      throw new SandboxApiConfigurationError(
        "SandboxAPI rejected this key. Check the key and your RapidAPI subscription.",
      );
    }
    if (response.status === 429) {
      throw new SandboxApiConfigurationError("SandboxAPI rate limit reached. Try again later.");
    }
    throw new SandboxApiConfigurationError(
      `SandboxAPI returned HTTP ${response.status} while checking languages.`,
    );
  }

  const payload = await readJsonResponse(response, MAX_LANGUAGE_RESPONSE_BYTES);
  const parsed = languageListSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SandboxApiConfigurationError("SandboxAPI returned an invalid language list.");
  }

  const entries = Array.isArray(parsed.data) ? parsed.data : parsed.data.languages;
  const available = new Set<string>();
  for (const language of entries) {
    for (const value of [language.id, language.language, language.name]) {
      if (value) available.add(value.trim().toLowerCase());
    }
  }

  const required = ["python3", "c", "java"];
  const missing = required.filter((language) => !available.has(language));
  if (missing.length) {
    throw new SandboxApiConfigurationError(
      `SandboxAPI connected, but ${missing.join(", ")} is not available.`,
    );
  }

  return required;
}
