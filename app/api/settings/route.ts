import { ApiError } from "@google/genai";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getAvailableGeminiModels,
  getEffectiveSettings,
  getEnvironmentApiKey,
  logGeminiFailure,
  toPublicGeminiError,
} from "@/lib/gemini";
import {
  SETTINGS_COOKIE,
  clearSessionSettings,
  getSessionSettings,
  saveSessionSettings,
} from "@/lib/session-settings";

export const runtime = "nodejs";
export const maxDuration = 60;

const apiKeySchema = z.string()
  .trim()
  .min(20)
  .max(512)
  .refine((apiKey) => !/\s/u.test(apiKey), "API keys cannot contain whitespace.");

const modelSchema = z.string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^(?:models\/)?[A-Za-z0-9._:-]+$/)
  .transform((model) => model.replace(/^models\//, ""));

const requestSchema = z.object({
  apiKey: apiKeySchema.optional(),
  model: modelSchema.optional(),
}).strict().refine((body) => body.apiKey !== undefined || body.model !== undefined);

function settingsResponse(
  configured: boolean,
  keySource: "session" | "environment" | "none",
  model: string | null,
  models: Awaited<ReturnType<typeof getAvailableGeminiModels>>,
) {
  const response = NextResponse.json({ configured, keySource, model, models });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
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

export async function GET(request: Request) {
  const settings = getEffectiveSettings(request);
  if (!settings.apiKey) return settingsResponse(false, "none", null, []);

  try {
    const models = await getAvailableGeminiModels(settings.apiKey);
    const requestedModel = settings.model?.replace(/^models\//, "") ?? null;
    const selectedModel = models.some((model) => model.id === requestedModel)
      ? requestedModel
      : models[0]?.id ?? null;
    return settingsResponse(true, settings.keySource, selectedModel, models);
  } catch (error) {
    logGeminiFailure("Settings model lookup failed", error);
    const publicError = toPublicGeminiError(error, "Gemini settings could not be loaded.");
    return NextResponse.json({ error: publicError.message }, { status: publicError.status });
  }
}

export async function POST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return NextResponse.json({ error: "Send settings as JSON." }, { status: 415 });
    }

    const body = requestSchema.parse(await request.json());
    const existingSession = getSessionSettings(request)?.settings;
    const environmentKey = getEnvironmentApiKey();
    const apiKey = body.apiKey || existingSession?.apiKey || environmentKey;
    if (!apiKey) {
      return NextResponse.json({ error: "Enter a Gemini API key first." }, { status: 400 });
    }

    const models = await getAvailableGeminiModels(apiKey, body.apiKey !== undefined);
    if (models.length === 0) {
      return NextResponse.json(
        { error: "This API key has no compatible image-understanding Gemini models." },
        { status: 400 },
      );
    }

    const currentModel = (existingSession?.model || process.env.GEMINI_MODEL?.trim())?.replace(/^models\//, "");
    const selected = body.model
      ? models.find((model) => model.id === body.model)
      : models.find((model) => model.id === currentModel) ?? models[0];
    if (!selected) {
      return NextResponse.json({ error: "Choose one of the available Gemini models." }, { status: 400 });
    }

    const sessionApiKey = body.apiKey || existingSession?.apiKey;
    const sessionId = saveSessionSettings(request, {
      apiKey: sessionApiKey,
      model: selected.id,
    });
    const keySource = sessionApiKey ? "session" : "environment";
    const response = settingsResponse(true, keySource, selected.id, models);
    setSessionCookie(response, sessionId);
    return response;
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: "Enter a valid API key and model." }, { status: 400 });
    }
    logGeminiFailure("Settings update failed", error);
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      return NextResponse.json({ error: "Google could not verify that API key." }, { status: 400 });
    }
    const publicError = toPublicGeminiError(error, "Gemini settings could not be saved.");
    return NextResponse.json({ error: publicError.message }, { status: publicError.status });
  }
}

export async function DELETE(request: Request) {
  const keepSessionCookie = clearSessionSettings(request, ["apiKey", "model"]);
  const environmentKey = getEnvironmentApiKey();
  const response = NextResponse.json({
    cleared: true,
    configured: Boolean(environmentKey),
    keySource: environmentKey ? "environment" : "none",
    model: environmentKey ? process.env.GEMINI_MODEL?.trim() || null : null,
    models: [],
  });
  response.headers.set("Cache-Control", "no-store, max-age=0");
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
