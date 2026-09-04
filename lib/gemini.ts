import "server-only";

import { createHash } from "node:crypto";

import { ApiError, GoogleGenAI, type Model } from "@google/genai";

import { getSessionSettings } from "@/lib/session-settings";

const GEMINI_TIMEOUT_MS = 55_000;
const MODEL_CACHE_TTL_MS = 10 * 60 * 1000;
export class GeminiConfigurationError extends Error {
  constructor(message = "Gemini is not configured. Add an API key in Settings and try again.") {
    super(message);
    this.name = "GeminiConfigurationError";
  }
}

export type PublicGeminiError = {
  message: string;
  status: number;
  retryAfterSeconds?: number;
};

export type GeminiModelOption = {
  id: string;
  displayName: string;
  description: string;
  inputTokenLimit: number | null;
  outputTokenLimit: number | null;
};

type ModelCacheEntry = {
  expiresAt: number;
  models: GeminiModelOption[];
};

const processState = globalThis as typeof globalThis & {
  __flowlensModelCache?: Map<string, ModelCacheEntry>;
};

const modelCache = processState.__flowlensModelCache ??= new Map<string, ModelCacheEntry>();

export function getEnvironmentApiKey() {
  return process.env.GOOGLE_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || null;
}

export function getEffectiveSettings(request: Request) {
  const session = getSessionSettings(request)?.settings;
  const environmentKey = getEnvironmentApiKey();
  const apiKey = session?.apiKey || environmentKey;
  const keySource = session?.apiKey ? "session" : environmentKey ? "environment" : "none";
  const model = session?.model || process.env.GEMINI_MODEL?.trim() || null;
  const modelSource = session?.model ? "session" : model ? "environment" : "none";
  return { apiKey, keySource, model, modelSource } as const;
}

export function getGeminiClient(apiKey: string) {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      retryOptions: {
        attempts: 3,
        initialDelay: 1,
        maxDelay: 4,
        expBase: 2,
        jitter: 0.5,
        // A 429 may represent a minute, daily, token, or spend quota. Surface it
        // to the UI instead of repeatedly consuming the same exhausted quota.
        httpStatusCodes: [408, 500, 502, 503, 504],
      },
    },
  });
}

export function getGeminiAbortSignal() {
  return AbortSignal.timeout(GEMINI_TIMEOUT_MS);
}

export function getGeminiRequestOptions() {
  return { timeout: GEMINI_TIMEOUT_MS, maxRetries: 0 } as const;
}

function normalizeModelId(name: string) {
  return name.replace(/^models\//, "");
}

function isImageUnderstandingModel(model: Model) {
  // The API does not expose input modalities directly. Gemini base models are
  // multimodal unless Google's live metadata marks them as specialist models.
  // Interactions-only models may not advertise the legacy generateContent action.
  const id = normalizeModelId(model.name ?? "");
  const identity = `${id} ${model.displayName ?? ""}`.toLowerCase();
  const details = `${identity} ${model.description ?? ""}`.toLowerCase();
  if (!identity.includes("gemini")) return false;

  const specialist = /\b(embedding|text[- ]to[- ]speech|tts|transcrib|audio generation|image generation|image generator|video generation|live api)\b/i;
  const specialistId = /(?:^|[-_.])(embedding|tts|transcribe|live|image)(?:$|[-_.])/i;
  return !specialist.test(details) && !specialistId.test(id);
}

function toModelOption(model: Model): GeminiModelOption | null {
  if (!model.name || !isImageUnderstandingModel(model)) return null;
  const id = normalizeModelId(model.name);
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(id)) return null;
  return {
    id,
    displayName: (model.displayName?.trim() || id).slice(0, 200),
    description: (model.description?.trim() || "Image-capable Gemini model").slice(0, 1000),
    inputTokenLimit: Number.isSafeInteger(model.inputTokenLimit) ? model.inputTokenLimit! : null,
    outputTokenLimit: Number.isSafeInteger(model.outputTokenLimit) ? model.outputTokenLimit! : null,
  };
}

function apiKeyFingerprint(apiKey: string) {
  return createHash("sha256").update(apiKey).digest("base64url");
}

export async function getAvailableGeminiModels(apiKey: string, forceRefresh = false) {
  const fingerprint = apiKeyFingerprint(apiKey);
  const cached = modelCache.get(fingerprint);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.models;

  const pager = await getGeminiClient(apiKey).models.list({
    config: {
      pageSize: 1000,
      queryBase: true,
      abortSignal: getGeminiAbortSignal(),
    },
  });

  const byId = new Map<string, GeminiModelOption>();
  for await (const model of pager) {
    const option = toModelOption(model);
    if (option) byId.set(option.id, option);
  }

  const models = [...byId.values()].sort((left, right) => left.displayName.localeCompare(right.displayName));
  modelCache.set(fingerprint, { models, expiresAt: Date.now() + MODEL_CACHE_TTL_MS });
  return models;
}

export async function getGeminiContext(request: Request) {
  const settings = getEffectiveSettings(request);
  if (!settings.apiKey) throw new GeminiConfigurationError();

  const models = await getAvailableGeminiModels(settings.apiKey);
  if (models.length === 0) {
    throw new GeminiConfigurationError("No image-capable Gemini models are available for this API key.");
  }

  const requestedModel = settings.model?.replace(/^models\//, "");
  const selected = models.find((model) => model.id === requestedModel);
  if (settings.modelSource === "session" && !selected) {
    throw new GeminiConfigurationError("The selected Gemini model is no longer available. Choose another model in Settings.");
  }
  return {
    client: getGeminiClient(settings.apiKey),
    model: (selected ?? models[0]).id,
    outputTokenLimit: (selected ?? models[0]).outputTokenLimit,
  };
}

export function logGeminiFailure(context: string, error: unknown) {
  const status = geminiErrorStatus(error);
  const name = error instanceof Error ? error.name : "UnknownError";
  console.error(context, { name, status });
}

function geminiErrorStatus(error: unknown) {
  if (error instanceof ApiError) return error.status;
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { status?: unknown; statusCode?: unknown };
  if (typeof candidate.status === "number") return candidate.status;
  if (typeof candidate.statusCode === "number") return candidate.statusCode;
  return undefined;
}

export function toPublicGeminiError(error: unknown, fallback: string): PublicGeminiError {
  if (error instanceof GeminiConfigurationError) {
    return { message: error.message, status: 503 };
  }

  const apiStatus = geminiErrorStatus(error);
  if (apiStatus !== undefined) {
    const apiMessage = error instanceof Error ? error.message : "";
    if (apiStatus === 429) {
      const retryMatch = apiMessage.match(/retry(?:\s+in|Delay["']?\s*:\s*["']?)[^\d]*(\d+(?:\.\d+)?)\s*s/i);
      const parsedDelay = retryMatch ? Math.ceil(Number(retryMatch[1])) : 60;
      const retryAfterSeconds = Number.isFinite(parsedDelay)
        ? Math.min(Math.max(parsedDelay, 1), 3600)
        : 60;
      const isDailyQuota = /requests?\s*per\s*day|perday|requestsperday|daily\s+quota|\bRPD\b/i.test(apiMessage);
      if (isDailyQuota) {
        return {
          message: "The selected Gemini model has reached its daily quota. Choose another model in Settings or wait for the quota reset at midnight Pacific time.",
          status: 429,
        };
      }
      return {
        message: `Gemini's rate limit is temporarily reached. Try again in about ${retryAfterSeconds} seconds, or choose another model in Settings.`,
        status: 429,
        retryAfterSeconds,
      };
    }
    if (apiStatus === 401 || apiStatus === 403) {
      return { message: "Gemini rejected the API key. Check it in Settings and try again.", status: 503 };
    }
    if (apiStatus === 404) {
      return { message: "The selected Gemini model is unavailable. Refresh the model list in Settings and choose another model.", status: 503 };
    }
    if (apiStatus >= 500) {
      return { message: "Gemini is temporarily unavailable. Please try again.", status: 502 };
    }
    return { message: fallback, status: 502 };
  }

  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return { message: "Gemini took too long to respond. Please try again.", status: 504 };
  }

  return { message: fallback, status: 500 };
}
