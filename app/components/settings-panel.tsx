"use client";

import { FormEvent, useCallback, useEffect, useId, useState } from "react";

import "../settings.css";

type GeminiModel = {
  id: string;
  displayName: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
};

type SettingsResponse = {
  configured?: boolean;
  keySource?: "session" | "environment" | "none";
  selectedModel?: string;
  model?: string;
  models?: Array<GeminiModel | string>;
  message?: string;
  error?: string;
};

type RunnerSettingsResponse = {
  configured?: boolean;
  source?: "session" | "environment" | "none";
  languages?: string[];
  message?: string;
  error?: string;
};

export type SettingsPanelProps = {
  endpoint?: string;
  onConfiguredChange?: (configured: boolean) => void;
};

function normalizeModels(items: SettingsResponse["models"]): GeminiModel[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => typeof item === "string"
      ? { id: item, displayName: item }
      : {
          id: item.id,
          displayName: item.displayName || item.id,
          description: item.description,
          inputTokenLimit: item.inputTokenLimit,
          outputTokenLimit: item.outputTokenLimit,
        })
    .filter((item) => Boolean(item.id));
}

function readableError(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.error === "string") return record.error;
    if (typeof record.message === "string") return record.message;
  }
  return fallback;
}

function formatTokens(value?: number) {
  if (!value) return null;
  return new Intl.NumberFormat("en", { notation: "compact" }).format(value);
}

function RunnerSettingsCard() {
  const keyId = useId();
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [source, setSource] = useState<"session" | "environment" | "none">("none");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const applyRunnerSettings = useCallback((payload: RunnerSettingsResponse) => {
    setConfigured(Boolean(payload.configured));
    setSource(payload.source ?? "none");
  }, []);

  const loadRunnerSettings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/runner-settings", { cache: "no-store" });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readableError(payload, "Could not load runner settings."));
      applyRunnerSettings((payload ?? {}) as RunnerSettingsResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load runner settings.");
    } finally {
      setLoading(false);
    }
  }, [applyRunnerSettings]);

  useEffect(() => {
    // Loading server-held connection status is the intended mount synchronization.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRunnerSettings();
  }, [loadRunnerSettings]);

  const saveRunner = async (event: FormEvent) => {
    event.preventDefault();
    const key = apiKey.trim();
    if (!key) {
      setError("Enter a SandboxAPI key first.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/runner-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readableError(payload, "SandboxAPI could not verify that key."));
      const settings = (payload ?? {}) as RunnerSettingsResponse;
      applyRunnerSettings(settings);
      setApiKey("");
      setShowKey(false);
      const languages = settings.languages?.join(", ") || "Python, C, and Java";
      setNotice(`SandboxAPI connected for ${languages}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "SandboxAPI could not verify that key.");
    } finally {
      setSaving(false);
    }
  };

  const clearRunner = async () => {
    setClearing(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/runner-settings", { method: "DELETE" });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readableError(payload, "Could not clear runner settings."));
      applyRunnerSettings((payload ?? {}) as RunnerSettingsResponse);
      setApiKey("");
      setShowKey(false);
      setNotice("Session SandboxAPI key cleared.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not clear runner settings.");
    } finally {
      setClearing(false);
    }
  };

  const statusLabel = loading
    ? "Checking"
    : source === "session"
      ? "SandboxAPI · session"
      : source === "environment"
        ? "SandboxAPI · environment"
        : "SandboxAPI · not configured";

  return (
    <form className="flow-settings__card flow-settings__runner" onSubmit={saveRunner}>
      <div className="flow-settings__card-head flow-settings__card-head--runner">
        <span className="flow-settings__step">03</span>
        <div>
          <h3>Connect SandboxAPI</h3>
          <p>Use the hosted sandbox to run Python, C, and Java without installing compilers.</p>
        </div>
        <div className={`flow-settings__state ${configured ? "is-ready" : ""}`} aria-live="polite">
          <span aria-hidden="true" />{statusLabel}
        </div>
      </div>

      <div className="flow-settings__field">
        <label className="flow-settings__label" htmlFor={keyId}>RapidAPI key</label>
        <div className="flow-settings__secret">
          <input
            id={keyId}
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Paste your X-RapidAPI-Key"
            autoComplete="off"
            spellCheck={false}
            disabled={saving || clearing}
          />
          <button type="button" onClick={() => setShowKey((value) => !value)} aria-pressed={showKey}>
            {showKey ? "Hide" : "Show"}
          </button>
        </div>
        <p className="flow-settings__hint">
          SandboxAPI includes 500 free executions per month. The key stays server-side and is never returned after saving.{" "}
          <a href="https://rapidapi.com/sandboxapidev/api/sandboxapi" target="_blank" rel="noreferrer">Open the API console ↗</a>{" · "}
          <a href="https://sandboxapi.dev/docs" target="_blank" rel="noreferrer">Read the docs ↗</a>
        </p>
      </div>

      <div className="flow-settings__actions flow-settings__runner-actions">
        <button className="flow-settings__primary" type="submit" disabled={saving || clearing || !apiKey.trim()}>
          {saving ? "Verifying…" : configured ? "Replace & verify key" : "Save & verify key"}
        </button>
        {source === "session" && (
          <button className="flow-settings__quiet" type="button" onClick={clearRunner} disabled={clearing}>
            {clearing ? "Clearing…" : "Clear session key"}
          </button>
        )}
      </div>

      {(notice || error) && (
        <div className={`flow-settings__notice ${error ? "is-error" : ""}`} role={error ? "alert" : "status"}>
          <span aria-hidden="true">{error ? "!" : "✓"}</span>{error || notice}
        </div>
      )}
    </form>
  );
}

export default function SettingsPanel({
  endpoint = "/api/settings",
  onConfiguredChange,
}: SettingsPanelProps) {
  const keyId = useId();
  const modelId = useId();
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [keySource, setKeySource] = useState<"session" | "environment" | "none">("none");
  const [models, setModels] = useState<GeminiModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [savedModel, setSavedModel] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const applySettings = useCallback((payload: SettingsResponse) => {
    const nextModels = normalizeModels(payload.models);
    const nextModel = payload.selectedModel ?? payload.model ?? "";
    setModels(nextModels);
    if (nextModel) {
      setSelectedModel(nextModel);
      setSavedModel(nextModel);
    } else if (nextModels.length) {
      setSelectedModel((current) => current || nextModels[0].id);
      setSavedModel("");
    } else {
      setSelectedModel("");
      setSavedModel("");
    }
    if (typeof payload.configured === "boolean") {
      setConfigured(payload.configured);
      onConfiguredChange?.(payload.configured);
      if (!payload.configured) {
        setModels([]);
        setSelectedModel("");
        setSavedModel("");
      }
    }
    if (payload.keySource) setKeySource(payload.keySource);
  }, [onConfiguredChange]);

  const loadSettings = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readableError(payload, "Could not load Gemini settings."));
      applySettings((payload ?? {}) as SettingsResponse);
      if (refresh) setNotice("Model list refreshed.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load Gemini settings.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [applySettings, endpoint]);

  useEffect(() => {
    // Loading remote configuration is the intended synchronization on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSettings();
  }, [loadSettings]);

  const saveKey = async (event: FormEvent) => {
    event.preventDefault();
    const key = apiKey.trim();
    if (!key) {
      setError("Enter a Gemini API key first.");
      return;
    }
    setSavingKey(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readableError(payload, "Gemini could not verify that key."));
      applySettings((payload ?? { configured: true }) as SettingsResponse);
      setConfigured(true);
      onConfiguredChange?.(true);
      setApiKey("");
      setShowKey(false);
      await loadSettings(true);
      setNotice("API key verified and saved for this session.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gemini could not verify that key.");
    } finally {
      setSavingKey(false);
    }
  };

  const saveModel = async () => {
    if (!selectedModel || selectedModel === savedModel) return;
    setSavingModel(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: selectedModel }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readableError(payload, "Could not save that model."));
      applySettings((payload ?? { selectedModel }) as SettingsResponse);
      setSavedModel(selectedModel);
      setNotice("Default Gemini model saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save that model.");
    } finally {
      setSavingModel(false);
    }
  };

  const clearKey = async () => {
    setClearing(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(endpoint, { method: "DELETE" });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readableError(payload, "Could not clear the session key."));
      applySettings((payload ?? { configured: false, keySource: "none" }) as SettingsResponse);
      setApiKey("");
      setNotice("Session key cleared.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not clear the session key.");
    } finally {
      setClearing(false);
    }
  };

  const activeModel = models.find((model) => model.id === selectedModel);
  const isBusy = loading || savingKey || savingModel || refreshing || clearing;

  return (
    <section className="flow-settings" id="settings" aria-labelledby="flow-settings-title">
      <div className="flow-settings__heading">
        <div>
          <p className="flow-settings__eyebrow">Workspace connections</p>
          <h2 id="flow-settings-title">App settings</h2>
          <p>Connect Gemini and the isolated code runner. Secrets stay server-side and are never shown again.</p>
        </div>
        <div className={`flow-settings__state ${configured ? "is-ready" : ""}`} aria-live="polite">
          <span aria-hidden="true" />
          {loading ? "Checking Gemini" : keySource === "session" ? "Gemini · session" : keySource === "environment" ? "Gemini · environment" : "Gemini · not configured"}
        </div>
      </div>

      <div className="flow-settings__grid" aria-busy={isBusy}>
        <form className="flow-settings__card" onSubmit={saveKey}>
          <div className="flow-settings__card-head">
            <span className="flow-settings__step">01</span>
            <div><h3>Connect Gemini</h3><p>Paste a Google AI Studio API key to verify access.</p></div>
          </div>
          <label className="flow-settings__label" htmlFor={keyId}>Gemini API key</label>
          <div className="flow-settings__secret">
            <input
              id={keyId}
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="AQ.… or AIza…"
              autoComplete="off"
              spellCheck={false}
              disabled={savingKey || clearing}
            />
            <button type="button" onClick={() => setShowKey((value) => !value)} aria-pressed={showKey}>
              {showKey ? "Hide" : "Show"}
            </button>
          </div>
          <div className="flow-settings__actions">
            <button className="flow-settings__primary" type="submit" disabled={savingKey || !apiKey.trim()}>
              {savingKey ? "Verifying…" : configured ? "Replace & verify key" : "Save & verify key"}
            </button>
            {keySource === "session" && (
              <button className="flow-settings__quiet" type="button" onClick={clearKey} disabled={clearing}>
                {clearing ? "Clearing…" : "Clear session key"}
              </button>
            )}
          </div>
        </form>

        <div className="flow-settings__card">
          <div className="flow-settings__card-head">
            <span className="flow-settings__step">02</span>
            <div><h3>Choose a model</h3><p>Select which compatible Gemini model handles flowcharts and chat.</p></div>
          </div>
          <div className="flow-settings__model-label">
            <label className="flow-settings__label" htmlFor={modelId}>Default model</label>
            <button type="button" onClick={() => void loadSettings(true)} disabled={refreshing || !configured}>
              {refreshing ? "Refreshing…" : "Refresh models"}
            </button>
          </div>
          <select
            id={modelId}
            value={selectedModel}
            onChange={(event) => setSelectedModel(event.target.value)}
            disabled={!configured || loading || models.length === 0}
          >
            {models.length === 0 && <option value="">{configured ? "No compatible models found" : "Connect Gemini first"}</option>}
            {models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}
          </select>
          {activeModel && (
            <div className="flow-settings__model-detail">
              <strong>{activeModel.displayName}</strong>
              {activeModel.description && <p>{activeModel.description}</p>}
              {(activeModel.inputTokenLimit || activeModel.outputTokenLimit) && (
                <div>
                  {activeModel.inputTokenLimit && <span>Input {formatTokens(activeModel.inputTokenLimit)}</span>}
                  {activeModel.outputTokenLimit && <span>Output {formatTokens(activeModel.outputTokenLimit)}</span>}
                </div>
              )}
            </div>
          )}
          <button
            className="flow-settings__primary flow-settings__save-model"
            type="button"
            onClick={saveModel}
            disabled={!configured || !selectedModel || selectedModel === savedModel || savingModel}
          >
            {savingModel ? "Saving…" : selectedModel === savedModel ? "Model saved" : "Save model"}
          </button>
        </div>

        <RunnerSettingsCard />
      </div>

      {(notice || error) && (
        <div className={`flow-settings__notice ${error ? "is-error" : ""}`} role={error ? "alert" : "status"}>
          <span aria-hidden="true">{error ? "!" : "✓"}</span>{error || notice}
        </div>
      )}
    </section>
  );
}
