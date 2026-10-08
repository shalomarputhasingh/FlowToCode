import "server-only";

import {
  GeminiConfigurationError,
  getAvailableGeminiModels,
  getEffectiveSettings,
  getGeminiClient,
  type GeminiModelOption,
} from "@/lib/gemini";
import { getAvailableGroqModels, type GroqModelOption } from "@/lib/groq";

const ATTEMPT_TIMEOUT_MS = 20_000;
const TOTAL_BUDGET_MS = 55_000;
const MAX_GEMINI_ATTEMPTS = 4;

// Used only when Google's live model list cannot be fetched.
const STATIC_GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"];

export type LlmRequest = {
  system: string;
  text: string;
  image?: { mimeType: string; data: string };
  json?: { schema?: unknown };
  maxOutputTokens: number;
};

export type LlmAttempt = { provider: string; model: string; status?: number; error: string };

export class AllProvidersFailedError extends Error {
  constructor(public attempts: LlmAttempt[]) {
    super("Every configured AI provider failed.");
    this.name = "AllProvidersFailedError";
  }
}

type Candidate = { provider: string; model: string; run: (signal: AbortSignal) => Promise<string> };

function errorStatus(error: unknown) {
  const candidate = error as { status?: unknown; statusCode?: unknown } | null;
  if (typeof candidate?.status === "number") return candidate.status;
  if (typeof candidate?.statusCode === "number") return candidate.statusCode;
  return undefined;
}

function rankGeminiModel(model: GeminiModelOption) {
  const id = model.id.toLowerCase();
  let rank = 0;
  if (/preview|exp|thinking/.test(id)) rank += 10;
  if (/lite/.test(id)) rank += 2;
  if (/pro/.test(id)) rank += 4;
  if (/\bflash\b|flash/.test(id)) rank -= 1;
  return rank;
}

async function geminiCandidates(request: Request, llm: LlmRequest): Promise<Candidate[]> {
  const settings = getEffectiveSettings(request);
  if (!settings.apiKey) return [];
  const apiKey = settings.apiKey;

  let ids: string[];
  try {
    const models = await getAvailableGeminiModels(apiKey);
    ids = [...models].sort((a, b) => rankGeminiModel(a) - rankGeminiModel(b)).map((m) => m.id);
  } catch {
    ids = [...STATIC_GEMINI_MODELS];
  }
  if (ids.length === 0) ids = [...STATIC_GEMINI_MODELS];

  const preferred = (settings.model ?? "").replace(/^models\//, "");
  if (preferred) ids = [preferred, ...ids.filter((id) => id !== preferred)];

  const client = getGeminiClient(apiKey);
  return ids.slice(0, MAX_GEMINI_ATTEMPTS).map((model) => ({
    provider: "gemini",
    model,
    run: async (signal) => {
      const parts: Array<Record<string, unknown>> = [];
      if (llm.image) parts.push({ inlineData: { mimeType: llm.image.mimeType, data: llm.image.data } });
      parts.push({ text: llm.text });
      const response = await client.models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: {
          systemInstruction: llm.system,
          maxOutputTokens: llm.maxOutputTokens,
          abortSignal: signal,
          ...(llm.json ? {
            responseMimeType: "application/json",
            ...(llm.json.schema ? { responseJsonSchema: llm.json.schema } : {}),
          } : {}),
        },
      });
      return response.text ?? "";
    },
  }));
}

type OpenAiStyle = {
  provider: string;
  baseUrl: string;
  apiKey: string | undefined;
  models: string[];
  vision: boolean[];
};

function openAiCandidates(config: OpenAiStyle, llm: LlmRequest): Candidate[] {
  if (!config.apiKey) return [];
  return config.models
    .filter((_, index) => !llm.image || config.vision[index])
    .map((model) => ({
      provider: config.provider,
      model,
      run: async (signal) => {
        const userContent = llm.image
          ? [
              { type: "text", text: llm.text },
              { type: "image_url", image_url: { url: `data:${llm.image.mimeType};base64,${llm.image.data}` } },
            ]
          : llm.text;
        const response = await fetch(`${config.baseUrl}/chat/completions`, {
          method: "POST",
          signal,
          headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: llm.system },
              { role: "user", content: userContent },
            ],
            max_tokens: Math.min(llm.maxOutputTokens, 8_192),
            temperature: 0.2,
            ...(llm.json ? { response_format: { type: "json_object" } } : {}),
          }),
        });
        if (!response.ok) {
          throw Object.assign(new Error(`${config.provider} responded ${response.status}`), { status: response.status });
        }
        const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
        return payload.choices?.[0]?.message?.content ?? "";
      },
    }));
}

function envList(name: string, fallback: string[]) {
  const value = process.env[name]?.split(",").map((item) => item.trim()).filter(Boolean);
  return value?.length ? value : fallback;
}

// Used only when Groq's live model list cannot be fetched.
const STATIC_GROQ_MODELS = [
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
];

function rankGroqModel(model: GroqModelOption) {
  const id = model.id.toLowerCase();
  let rank = 0;
  if (/preview|exp/.test(id)) rank += 10;
  if (/maverick/.test(id)) rank += 1; // Scout is lighter/faster; try it first.
  if (/70b|90b|405b/.test(id)) rank += 3;
  return rank;
}

async function fallbackCandidates(llm: LlmRequest): Promise<Candidate[]> {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) return [];

  let models: GroqModelOption[];
  try {
    models = await getAvailableGroqModels(apiKey);
  } catch {
    models = [];
  }

  // A free-tier key only ever sees the handful of models its plan grants,
  // so the override list still applies when it is set, but otherwise we
  // trust whatever Groq's API actually reports as available right now.
  const envOverride = process.env.GROQ_MODELS?.trim();
  let ids: string[];
  if (envOverride) {
    ids = envList("GROQ_MODELS", STATIC_GROQ_MODELS);
  } else if (models.length > 0) {
    const pool = llm.image ? models.filter((m) => m.visionCapable) : models;
    ids = [...(pool.length > 0 ? pool : models)]
      .sort((a, b) => rankGroqModel(a) - rankGroqModel(b))
      .map((m) => m.id);
  } else {
    ids = [...STATIC_GROQ_MODELS];
  }
  if (ids.length === 0) ids = [...STATIC_GROQ_MODELS];

  return openAiCandidates({
    provider: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKey,
    models: ids,
    vision: ids.map(() => true),
  }, llm);
}

/**
 * Runs the request against Gemini models first, then Groq Grok,
 * moving to the next candidate on any failure, including output that fails
 * `parse`. Returns the first successfully parsed value.
 */
export async function generateWithFallback<T>(
  request: Request,
  llm: LlmRequest,
  parse: (text: string) => T,
): Promise<{ value: T; provider: string; model: string }> {
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const [geminiList, groqList] = await Promise.all([geminiCandidates(request, llm), fallbackCandidates(llm)]);
  const candidates = [...geminiList, ...groqList];
  if (candidates.length === 0) throw new GeminiConfigurationError(
    "No AI provider is configured. Add a Gemini API key in Settings, or set GROQ_API_KEY.",
  );

  const attempts: LlmAttempt[] = [];
  for (const candidate of candidates) {
    const remaining = deadline - Date.now();
    if (remaining < 2_000) break;
    try {
      const signal = AbortSignal.timeout(Math.min(ATTEMPT_TIMEOUT_MS, remaining));
      const text = await candidate.run(signal);
      if (!text.trim()) throw new Error("Empty response.");
      return { value: parse(text), provider: candidate.provider, model: candidate.model };
    } catch (error) {
      const status = errorStatus(error);
      const message = error instanceof Error ? error.name : "UnknownError";
      console.error("LLM attempt failed", { provider: candidate.provider, model: candidate.model, status, message });
      attempts.push({ provider: candidate.provider, model: candidate.model, status, error: message });
    }
  }
  throw new AllProvidersFailedError(attempts);
}

export function toPublicLlmError(error: unknown, fallback: string) {
  if (error instanceof GeminiConfigurationError) return { message: error.message, status: 503 };
  if (error instanceof AllProvidersFailedError) {
    if (error.attempts.length > 0 && error.attempts.every((a) => a.status === 401 || a.status === 403)) {
      return { message: "The AI providers rejected the configured API keys. Check them in Settings.", status: 503 };
    }
    if (error.attempts.some((a) => a.status === 429)) {
      return {
        message: "All AI providers are rate limited right now. Please try again in a minute.",
        status: 429,
        retryAfterSeconds: 60,
      };
    }
    return { message: "All AI providers are temporarily unavailable. Please try again shortly.", status: 502 };
  }
  return { message: fallback, status: 500 };
}
