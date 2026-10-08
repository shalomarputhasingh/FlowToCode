import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getAvailableGroqModels,
  getEffectiveGroqSettings,
  toPublicGroqError,
} from "@/lib/groq";
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
  __flowlensGroqVerificationRates?: Map<string, VerificationRate>;
};
const verificationRates = processState.__flowlensGroqVerificationRates ??= new Map<string, VerificationRate>();

const requestSchema = z.object({
  apiKey: z.string().trim().min(20).max(256).refine((key) => !/\s/u.test(key), "API keys cannot contain whitespace.").optional(),
  model: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9._/:-]+$/).optional(),
}).strict().refine((body) => body.apiKey !== undefined || body.model !== undefined);

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

async function groqResponse(request: Request) {
  const settings = getEffectiveGroqSettings(request);
  if (!settings.apiKey) {
    return jsonNoStore({ configured: false, source: "none", models: [], selectedModel: null });
  }
  try {
    const models = await getAvailableGroqModels(settings.apiKey);
    const requestedModel = settings.model;
    const selectedModel = models.some((model) => model.id === requestedModel)
      ? requestedModel
      : models[0]?.id ?? null;
    return jsonNoStore({
      configured: true,
      source: settings.keySource,
      models: models.map((m) => ({ id: m.id, visionCapable: m.visionCapable })),
      selectedModel,
    });
  } catch (error) {
    const publicError = toPublicGroqError(error, "Groq settings could not be loaded.");
    return jsonNoStore({ error: publicError.message }, { status: publicError.status });
  }
}

export async function GET(request: Request) {
  return groqResponse(request);
}

export async function POST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return jsonNoStore({ error: "Send settings as JSON." }, { status: 415 });
    }

    const body = requestSchema.parse(await request.json());
    const existingSession = getSessionSettings(request)?.settings;

    // Model-only update: just save the preferred model, no re-verification needed.
    if (body.apiKey === undefined) {
      const apiKey = existingSession?.groqApiKey || getEffectiveGroqSettings(request).apiKey;
      if (!apiKey) return jsonNoStore({ error: "Connect a Groq key first." }, { status: 400 });
      const models = await getAvailableGroqModels(apiKey);
      if (body.model && !models.some((m) => m.id === body.model)) {
        return jsonNoStore({ error: "Choose one of the available Groq models." }, { status: 400 });
      }
      const sessionId = saveSessionSettings(request, { groqModel: body.model });
      const response = jsonNoStore({
        configured: true,
        source: existingSession?.groqApiKey ? "session" : "environment",
        models: models.map((m) => ({ id: m.id, visionCapable: m.visionCapable })),
        selectedModel: body.model,
      });
      setSessionCookie(response, sessionId);
      return response;
    }

    if (!consumeVerificationAllowance(request)) {
      return jsonNoStore({ error: "Too many key checks. Try again in a minute." }, { status: 429 });
    }

    const models = await getAvailableGroqModels(body.apiKey, true);
    if (models.length === 0) {
      return jsonNoStore({ error: "This Groq key has no available chat models right now." }, { status: 400 });
    }

    const selected = body.model && models.some((m) => m.id === body.model) ? body.model : undefined;
    const sessionId = saveSessionSettings(request, { groqApiKey: body.apiKey, groqModel: selected });
    const response = jsonNoStore({
      configured: true,
      source: "session",
      models: models.map((m) => ({ id: m.id, visionCapable: m.visionCapable })),
      selectedModel: selected ?? models[0]?.id ?? null,
    });
    setSessionCookie(response, sessionId);
    return response;
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return jsonNoStore({ error: "Enter a valid Groq API key." }, { status: 400 });
    }
    console.error("Groq settings verification failed", { name: error instanceof Error ? error.name : "UnknownError" });
    const publicError = toPublicGroqError(error, "Groq rejected that API key.");
    return jsonNoStore({ error: publicError.message }, { status: publicError.status });
  }
}

export async function DELETE(request: Request) {
  const keepSessionCookie = clearSessionSettings(request, ["groqApiKey", "groqModel"]);
  const response = await groqResponse(request);
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
