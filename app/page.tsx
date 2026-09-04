"use client";

import { ChangeEvent, DragEvent, FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";

import type { ChatMessage, CodeBundle, FlowAnalysis, Language } from "@/lib/types";

const languageLabels: Record<Language, string> = {
  python: "Python",
  c: "C",
  java: "Java",
};

const starterQuestions = [
  "Explain the loop simply",
  "Why is this condition needed?",
  "Walk me through an example input",
];

function responseError(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const value = (payload as { error?: unknown }).error;
    if (typeof value === "string") return value.replace(/\bGemini\b/g, "AI service");
  }
  return fallback;
}

function retryAfterSeconds(response: Response) {
  const value = Number(response.headers.get("retry-after"));
  return Number.isFinite(value) && value > 0 ? Math.min(Math.ceil(value), 3600) : 0;
}

export default function Home() {
  const [image, setImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const [analysis, setAnalysis] = useState<FlowAnalysis | null>(null);
  const [codes, setCodes] = useState<CodeBundle | null>(null);
  const [language, setLanguage] = useState<Language>("python");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [stdin, setStdin] = useState("");
  const [runOutput, setRunOutput] = useState("");
  const [runStatus, setRunStatus] = useState("");
  const [running, setRunning] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [chatting, setChatting] = useState(false);
  const [geminiCooldown, setGeminiCooldown] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!image) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(image);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatting]);

  useEffect(() => {
    if (geminiCooldown <= 0) return;
    const timer = window.setTimeout(() => {
      setGeminiCooldown((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [geminiCooldown]);

  const chooseImage = (file: File | null) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Choose a PNG, JPEG, or WebP flowchart.");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setError("Choose an image smaller than 12 MB.");
      return;
    }
    setImage(file);
    setAnalysis(null);
    setCodes(null);
    setMessages([]);
    setRunOutput("");
    setError("");
  };

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    chooseImage(event.target.files?.[0] ?? null);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    chooseImage(event.dataTransfer.files?.[0] ?? null);
  };

  const analyze = async (event: FormEvent) => {
    event.preventDefault();
    if (!image) {
      setError("Add a flowchart image to begin.");
      return;
    }

    setAnalyzing(true);
    setError("");
    setRunOutput("");
    const form = new FormData();
    form.append("image", image);

    try {
      const response = await fetch("/api/analyze", { method: "POST", body: form });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setGeminiCooldown(retryAfterSeconds(response));
        throw new Error(responseError(payload, "The AI service could not read this flowchart."));
      }
      const nextAnalysis = payload as FlowAnalysis;
      setAnalysis(nextAnalysis);
      setCodes(nextAnalysis.codes);
      setMessages([{
        role: "assistant",
        content: `I’ve mapped “${nextAnalysis.title}”. Ask me about a branch, loop, variable, or any line of code.`,
      }]);
    } catch (caught) {
      setAnalysis(null);
      setCodes(null);
      setError(caught instanceof Error ? caught.message : "The AI service could not read this flowchart.");
    } finally {
      setAnalyzing(false);
    }
  };

  const currentCode = codes?.[language] ?? "";

  const changeLanguage = (nextLanguage: Language) => {
    setLanguage(nextLanguage);
    setRunOutput("");
    setRunStatus("");
    setCopied(false);
  };

  const updateCode = (value: string) => {
    if (!codes) return;
    setCodes({ ...codes, [language]: value });
  };

  const copyCode = async () => {
    if (!currentCode) return;
    await navigator.clipboard.writeText(currentCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const runCode = async () => {
    if (!currentCode) return;
    setRunning(true);
    setRunOutput("");
    setRunStatus("Running");

    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, code: currentCode, stdin }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(payload, "The runner did not complete."));
      const result = payload as { output: string; status: string; exitCode: number | null };
      setRunOutput(result.output);
      setRunStatus(result.status === "OK" ? "Finished" : result.status);
    } catch (caught) {
      setRunOutput(caught instanceof Error ? caught.message : "The runner did not complete.");
      setRunStatus("Runner unavailable");
    } finally {
      setRunning(false);
    }
  };

  const ask = async (event?: FormEvent, suggestedQuestion?: string) => {
    event?.preventDefault();
    const text = (suggestedQuestion ?? question).trim();
    if (!text || !analysis || !currentCode || chatting) return;

    const previous = messages.slice(-8);
    setMessages([...messages, { role: "user", content: text }]);
    setQuestion("");
    setChatting(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: text,
          language,
          code: currentCode,
          analysis: {
            title: analysis.title,
            summary: analysis.summary,
            algorithm: analysis.algorithm,
            assumptions: analysis.assumptions,
            complexity: analysis.complexity,
          },
          history: previous,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setGeminiCooldown(retryAfterSeconds(response));
        throw new Error(responseError(payload, "The tutor could not answer right now."));
      }
      setMessages((current) => [...current, { role: "assistant", content: (payload as { answer: string }).answer }]);
    } catch (caught) {
      setMessages((current) => [...current, {
        role: "assistant",
        content: caught instanceof Error ? caught.message : "The tutor could not answer right now.",
      }]);
    } finally {
      setChatting(false);
    }
  };

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="FlowToCode home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>FLOWTOCODE</span>
        </a>
        <div className="topbar-actions">
          <Link className="settings-link" href="/settings">Settings</Link>
          <div className="topbar-note">
            <span className="live-dot" /> AI vision workspace
          </div>
        </div>
      </header>

      <section className="intro" id="top">
        <div>
          <p className="kicker">Image → logic → code</p>
          <h1>Show it the flow.<br /><span>Ship the algorithm.</span></h1>
        </div>
        <p className="intro-copy">
          Upload any readable flowchart. FlowToCode follows the arrows, recovers the decisions, and builds
          equivalent programs you can inspect, run, and question.
        </p>
      </section>

      <section className="workspace" aria-label="Flowchart workspace">
        <form className="upload-panel" onSubmit={analyze}>
          <div className="section-label"><span>Source image</span><small>PNG · JPEG · WEBP</small></div>
          <div
            className={`drop-field ${dragging ? "is-dragging" : ""} ${previewUrl ? "has-preview" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFileInput} />
            {previewUrl ? (
              // A blob URL needs a regular image element; it never leaves this browser tab.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="Selected flowchart preview" />
            ) : (
              <div className="drop-invite">
                <span className="diagram-seed" aria-hidden="true"><b /><b /><b /></span>
                <strong>Drop your flowchart</strong>
                <p>Clear arrows and readable labels give the strongest result.</p>
              </div>
            )}
            <button type="button" className="replace-button" onClick={() => fileInput.current?.click()}>
              {image ? "Replace image" : "Choose image"}
            </button>
          </div>

          <div className="analyze-row">
            <div className="file-meta">
              <span>{image?.name ?? "No image selected"}</span>
              <small>{image ? `${(image.size / 1024 / 1024).toFixed(2)} MB` : "Up to 12 MB"}</small>
            </div>
            <button className="analyze-button" type="submit" disabled={analyzing || !image || geminiCooldown > 0}>
              {analyzing ? "Tracing the diagram…" : geminiCooldown > 0 ? `Retry in ${geminiCooldown}s` : "Analyze flowchart"}<b aria-hidden="true">↗</b>
            </button>
          </div>
          {error && <div className="error-banner" role="alert"><b>!</b><span>{error}</span></div>}
        </form>

        <aside className="logic-panel">
          <div className="section-label"><span>Recovered logic</span><small>{analysis ? `${Math.round(analysis.confidence * 100)}% confidence` : "Waiting"}</small></div>
          {!analysis ? (
            <div className="logic-empty">
              <div className={`scan-path ${analyzing ? "is-scanning" : ""}`} aria-hidden="true">
                <i /><i /><i /><i />
              </div>
              <h2>{analyzing ? "Following every connector" : "The trace appears here"}</h2>
              <p>{analyzing ? "FlowToCode is resolving shapes, labels, branches, and loops." : "One image becomes an editable program in three languages."}</p>
            </div>
          ) : (
            <div className="logic-result">
              <div className="logic-title">
                <p>Detected algorithm</p>
                <h2>{analysis.title}</h2>
                <span>{analysis.summary}</span>
              </div>
              <ol className="algorithm-list">
                {analysis.algorithm.map((step, index) => <li key={`${step}-${index}`}><b>{String(index + 1).padStart(2, "0")}</b><span>{step}</span></li>)}
              </ol>
              <div className="complexity-row">
                <div><small>Time</small><strong>{analysis.complexity.time}</strong></div>
                <div><small>Space</small><strong>{analysis.complexity.space}</strong></div>
              </div>
              {analysis.assumptions.length > 0 && (
                <details className="assumptions">
                  <summary>{analysis.assumptions.length} visual assumption{analysis.assumptions.length === 1 ? "" : "s"}</summary>
                  <ul>{analysis.assumptions.map((item) => <li key={item}>{item}</li>)}</ul>
                </details>
              )}
            </div>
          )}
        </aside>
      </section>

      {analysis && codes && (
        <section className="output-deck" aria-live="polite">
          <div className="deck-heading">
            <div><p className="kicker">Generated program</p><h2>Inspect it. Test it. Ask why.</h2></div>
            <div className="language-switch" role="tablist" aria-label="Programming language">
              {(["python", "c", "java"] as Language[]).map((item) => (
                <button key={item} type="button" role="tab" aria-selected={language === item} className={language === item ? "active" : ""} onClick={() => changeLanguage(item)}>
                  {languageLabels[item]}
                </button>
              ))}
            </div>
          </div>

          <div className="code-stage">
            <section className="editor-panel" aria-label={`${languageLabels[language]} code editor`}>
              <div className="editor-bar">
                <span><i /> main.{language === "python" ? "py" : language === "java" ? "java" : "c"}</span>
                <div>
                  <button type="button" onClick={copyCode}>{copied ? "Copied" : "Copy code"}</button>
                  <button className="run-button" type="button" onClick={runCode} disabled={running}>{running ? "Running…" : "Run code"} <b>▶</b></button>
                </div>
              </div>
              <textarea className="code-editor" spellCheck={false} value={currentCode} onChange={(event) => updateCode(event.target.value)} aria-label={`${languageLabels[language]} generated code`} />
            </section>

            <section className="console-panel" aria-label="Program console">
              <div className="console-heading"><span>Program console</span><small className={runStatus === "Finished" ? "success" : ""}>{runStatus || "Ready"}</small></div>
              <label htmlFor="stdin">Enter program values</label>
              <textarea
                id="stdin"
                value={stdin}
                onChange={(event) => setStdin(event.target.value)}
                spellCheck={false}
                aria-describedby="stdin-help"
                placeholder={"Type values directly here\nUse one line or spaces, for example: 15 4"}
              />
              <small className="console-input-help" id="stdin-help">
                Add every value before selecting Run code. FlowToCode sends them to the program in this order.
              </small>
              <div className="output-label"><span>Output</span><small>Sandboxed runner</small></div>
              <pre>{runOutput || "Run the program to see its output here."}</pre>
            </section>
          </div>

          <section className="tutor-panel" aria-label="AI code tutor">
            <div className="tutor-intro">
              <span className="tutor-orbit" aria-hidden="true"><i /></span>
              <div><p className="kicker">AI code tutor</p><h2>Question the logic</h2></div>
              <p>Ask about the current language. The tutor sees the recovered algorithm and your edited code.</p>
            </div>
            <div className="chat-shell">
              <div className="messages" aria-live="polite">
                {messages.map((message, index) => (
                  <div className={`message ${message.role}`} key={`${message.role}-${index}`}>
                    <small>{message.role === "assistant" ? "FlowToCode" : "You"}</small>
                    <p>{message.content}</p>
                  </div>
                ))}
                {chatting && <div className="message assistant typing"><small>FlowToCode</small><p><i /><i /><i /></p></div>}
                <div ref={chatEnd} />
              </div>
              <div className="question-chips">
                {starterQuestions.map((item) => <button type="button" key={item} onClick={() => void ask(undefined, item)} disabled={chatting || geminiCooldown > 0}>{item}</button>)}
              </div>
              <form className="chat-form" onSubmit={(event) => void ask(event)}>
                <label htmlFor="question">Ask about this code</label>
                <input id="question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What happens when x is even?" autoComplete="off" />
                <button type="submit" disabled={chatting || geminiCooldown > 0 || !question.trim()} aria-label="Send question">↑</button>
              </form>
            </div>
          </section>
        </section>
      )}

      <footer>
        <span>FLOWTOCODE</span>
        <p>AI-generated code can be wrong. Review assumptions and test with representative inputs.</p>
      </footer>
    </main>
  );
}
