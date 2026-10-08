import "server-only";

import { createHash } from "node:crypto";

import { getSessionSettings } from "@/lib/session-settings";

const GROQ_TIMEOUT_MS = 15_000;
const MODEL_CACHE_TTL_MS = 10 * 60 * 1000;

export class GroqConfigurationError extends Error {
  constructor(message = "Groq is not configured. Add an API key in Settings or set GROQ_API_KEY.") {
    super(message);
    this.name = "GroqConfigurationError";
  }
}

export function getEnvironmentGroqApiKey() {
  return process.env.GROQ_API_KEY?.trim() || null;
}

/** Session key (entered in Settings) takes priority over the environment key. */
export function getEffectiveGroqSettings(request: Request) {
  const session = getSessionSettings(request)?.settings;
  const environmentKey = getEnvironmentGroqApiKey();
  const apiKey = session?.groqApiKey || environmentKey || null;
  const keySource: "session" | "environment" | "none" = session?.groqApiKey ? "session" : environmentKey ? "environment" : "none";
  const model = session?.groqModel || null;
  return { apiKey, keySource, model } as const;
}

export type GroqModelOption = {
  id: string;
  ownedBy: string;
  contextWindow: number | null;
  active: boolean;
  visionCapable: boolean;
};

type ModelCacheEntry = {
  expiresAt: number;
  models: GroqModelOption[];
};

const processState = globalThis as typeof globalThis & {
  __flowlensGroqModelCache?: Map<string, ModelCacheEntry>;
};

const modelCache = processState.__flowlensGroqModelCache ??= new Map<string, ModelCacheEntry>();

// Groq's API does not report input modalities. These families are the ones
// known to accept image input; everything else is text-only.
const VISION_MODEL_PATTERN = /llama-4-(scout|maverick)|llava|vision/i;

// Models that exist in the Groq catalog but are not general chat models
// (safety classifiers, audio, TTS, or guard rails) and should never be
// offered as a flowchart or tutor candidate.
const NON_CHAT_MODEL_PATTERN = /guard|whisper|tts|prompt-guard|moderation/i;

function apiKeyFingerprint(apiKey: string) {
  return createHash("sha256").update(apiKey).digest("base64url");
}

function toModelOption(raw: { id?: string; owned_by?: string; context_window?: number; active?: boolean }): GroqModelOption | null {
  if (!raw.id || typeof raw.id !== "string") return null;
  if (NON_CHAT_MODEL_PATTERN.test(raw.id)) return null;
  return {
    id: raw.id,
    ownedBy: raw.owned_by ?? "groq",
    contextWindow: Number.isSafeInteger(raw.context_window) ? raw.context_window! : null,
    active: raw.active !== false,
    visionCapable: VISION_MODEL_PATTERN.test(raw.id),
  };
}

/**
 * Fetches the live Groq model catalog for this API key (free tier accounts
 * only see the small set of models their plan grants). Falls back to the
 * cached copy on transient failure so a single flaky request does not take
 * Groq out of the fallback chain.
 */
export function toPublicGroqError(error: unknown, fallback: string) {
  if (error instanceof GroqConfigurationError) return { message: error.message, status: 503 };
  const status = (error as { status?: unknown })?.status;
  if (status === 401 || status === 403) return { message: "Groq rejected that API key.", status: 400 };
  if (status === 429) return { message: "Groq's rate limit is reached right now. Try again shortly.", status: 429 };
  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return { message: "Groq took too long to respond.", status: 504 };
  }
  return { message: fallback, status: 502 };
}

export async function getAvailableGroqModels(apiKey: string, forceRefresh = false): Promise<GroqModelOption[]> {
  const fingerprint = apiKeyFingerprint(apiKey);
  const cached = modelCache.get(fingerprint);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.models;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw Object.assign(new Error(`Groq model list responded ${response.status}`), { status: response.status });
    }
    const payload = await response.json() as { data?: Array<Record<string, unknown>> };
    const byId = new Map<string, GroqModelOption>();
    for (const raw of payload.data ?? []) {
      const option = toModelOption(raw as { id?: string; owned_by?: string; context_window?: number; active?: boolean });
      if (option && option.active) byId.set(option.id, option);
    }
    const models = [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
    modelCache.set(fingerprint, { models, expiresAt: Date.now() + MODEL_CACHE_TTL_MS });
    return models;
  } catch (error) {
    if (cached) return cached.models;
    throw error;
  }
}
