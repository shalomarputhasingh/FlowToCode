import "server-only";

import { randomBytes } from "node:crypto";

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_SESSIONS = 500;

export const SETTINGS_COOKIE = "flowlens_session";

export type SessionSettings = {
  apiKey?: string;
  model?: string;
  sandboxApiKey?: string;
  expiresAt: number;
  updatedAt: number;
};

type SessionValues = Omit<SessionSettings, "expiresAt" | "updatedAt">;

const processState = globalThis as typeof globalThis & {
  __flowlensSettingsStore?: Map<string, SessionSettings>;
};

const settingsStore = processState.__flowlensSettingsStore ??= new Map<string, SessionSettings>();

function parseCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
    const value = item.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

function cleanExpiredSessions() {
  const now = Date.now();
  for (const [id, settings] of settingsStore) {
    if (settings.expiresAt <= now) settingsStore.delete(id);
  }

  if (settingsStore.size <= MAX_SESSIONS) return;
  const oldest = [...settingsStore.entries()]
    .sort((left, right) => left[1].updatedAt - right[1].updatedAt)
    .slice(0, settingsStore.size - MAX_SESSIONS);
  for (const [id] of oldest) settingsStore.delete(id);
}

function hasStoredValues(settings: SessionSettings) {
  return Boolean(settings.apiKey || settings.model || settings.sandboxApiKey);
}

export function getSessionSettings(request: Request) {
  cleanExpiredSessions();
  const sessionId = parseCookie(request, SETTINGS_COOKIE);
  if (!sessionId || !/^[A-Za-z0-9_-]{32,64}$/.test(sessionId)) return null;

  const settings = settingsStore.get(sessionId);
  if (!settings) return null;
  const now = Date.now();
  settings.expiresAt = now + SESSION_TTL_MS;
  settings.updatedAt = now;
  return { sessionId, settings };
}

export function saveSessionSettings(request: Request, values: Partial<SessionValues>) {
  const existing = getSessionSettings(request);
  const sessionId = existing?.sessionId ?? randomBytes(32).toString("base64url");
  const now = Date.now();
  settingsStore.set(sessionId, {
    ...existing?.settings,
    ...values,
    expiresAt: now + SESSION_TTL_MS,
    updatedAt: now,
  });
  cleanExpiredSessions();
  return sessionId;
}

export function clearSessionSettings(
  request: Request,
  keys: Array<keyof SessionValues>,
) {
  const existing = getSessionSettings(request);
  if (!existing) return false;

  for (const key of keys) delete existing.settings[key];
  if (!hasStoredValues(existing.settings)) {
    settingsStore.delete(existing.sessionId);
    return false;
  }
  return true;
}
