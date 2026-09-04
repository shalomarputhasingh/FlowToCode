import type { Metadata } from "next";
import Link from "next/link";

import SettingsPanel from "@/app/components/settings-panel";

export const metadata: Metadata = {
  title: "Settings — FlowToCode",
  description: "Configure Gemini and the SandboxAPI code runner for FlowToCode.",
};

export default function SettingsPage() {
  return (
    <main className="settings-page">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Return to FlowToCode workbench">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>FLOWTOCODE</span>
        </Link>
        <div className="topbar-actions">
          <Link className="settings-link" href="/">← Workbench</Link>
          <div className="topbar-note"><span className="live-dot" /> Configuration</div>
        </div>
      </header>

      <section className="settings-hero">
        <p className="kicker">Private configuration</p>
        <div>
          <h1>Choose the<br /><span>thinking engine.</span></h1>
          <p>
            Connect Google Gemini and the isolated SandboxAPI runner from one private panel.
            FlowToCode verifies both connections before using them.
          </p>
        </div>
      </section>

      <SettingsPanel />

      <aside className="settings-footnote">
        <b>Session boundary</b>
        <p>Your submitted Gemini and SandboxAPI keys stay in server memory and clear when the app server restarts.</p>
        <Link href="/">Return to the flowchart workbench →</Link>
      </aside>

      <footer>
        <span>FLOWTOCODE / SETTINGS</span>
        <p>Model metadata comes from Gemini. Runner languages are checked directly against SandboxAPI.</p>
      </footer>
    </main>
  );
}
