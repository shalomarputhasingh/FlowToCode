# FlowToCode

FlowToCode is a Next.js app that sends a flowchart image directly to Google Gemini, turns the interpreted algorithm into Python, C, and Java, and presents the result in one workspace. It also includes an AI tutor for code explanations and an optional isolated runner for trying generated programs with standard input.

There is no local OCR pipeline. Image understanding and code generation happen through the Gemini API.

Gemini responses pass through LangChain's `StructuredOutputParser` and a Zod schema before reaching the UI. The parser extracts JSON (including fenced JSON), validates every analysis field, and rejects incomplete Python, C, or Java bundles.

## Quick start

```powershell
git clone https://github.com/shalomarputhasingh/FlowToCode.git
cd FlowToCode
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), then visit [Settings](http://localhost:3000/settings) to connect Gemini and, optionally, the isolated code runner. You do not need to create an environment file when you enter the keys in Settings.

For persistent server-side configuration, copy the safe template before starting the app:

```powershell
Copy-Item .env.example .env.local
```

On macOS or Linux, use `cp .env.example .env.local` instead. Replace only the placeholder values in `.env.local`; that file is intentionally excluded from Git.

## What you need

- Windows 10/11, macOS, or Linux
- Node.js 20.9 or newer (the current Node.js LTS release is recommended)
- npm, included with Node.js
- A Google AI Studio API key with access to a compatible Gemini model
- For **Run code**: a SandboxAPI subscription and RapidAPI key; the free plan includes 500 executions per month

## Windows setup

1. Install the current Node.js LTS release from [nodejs.org](https://nodejs.org/). The standard installer includes npm.
2. Open a new PowerShell window in this project folder.
3. Check the installation:

   ```powershell
   node --version
   npm --version
   ```

4. Install the project packages:

   ```powershell
   npm install
   ```

5. For persistent local/deployment configuration, create your private environment file:

   ```powershell
   Copy-Item .env.example .env.local
   ```

6. Open `.env.local` and replace the example values described below. You can instead add the Gemini key from the in-app **Settings** panel after starting the app.

If PowerShell reports that script execution is disabled when running `npm`, use `npm.cmd install` and `npm.cmd run dev`, or adjust your own PowerShell execution policy according to your organization's rules.

## Gemini configuration

Create an API key in [Google AI Studio](https://aistudio.google.com/app/apikey). You can configure it in either of two ways.

### In-app Settings

Open **Settings**, paste the API key, and submit it. The key is sent to the Next.js server and held server-side only for the current app process/session. The server never returns the key to the browser after submission; the browser receives only configuration status and the available model information.

This Settings value is intentionally not durable storage: restarting the server process clears it. Do not rely on it as encrypted persistence. In multi-instance or serverless deployments, process-local state may also differ between instances.

After a key is accepted, the model choices shown in Settings are fetched from Google for that key. They are not a hardcoded list, so the options reflect models the associated Google project can currently access.

### Environment fallback

For a persistent development/deployment fallback, place the key in `.env.local` or your hosting provider's server-side environment configuration:

```dotenv
GEMINI_API_KEY=your_real_key
GEMINI_MODEL=gemini-3.7-flash
```

`GEMINI_API_KEY` stays on the server and is used when no temporary Settings key is active. Do not prefix it with `NEXT_PUBLIC_` or commit `.env.local`. After changing environment values, restart the development server.

`GEMINI_MODEL` provides the server-side default/fallback model. The app defaults to `gemini-3.7-flash`, while the selectable options in Settings are discovered from Google's API rather than being hardcoded.

## SandboxAPI code-runner configuration

Generated programs are untrusted input. They must not be executed with `child_process`, a shell command, or a compiler installed on the same machine/account as the Next.js server. A malicious or malformed flowchart could otherwise cause code to read files, consume resources, or attack the host.

FlowToCode delegates execution to [SandboxAPI](https://sandboxapi.dev/docs), a hosted isolated code runner available through [RapidAPI](https://rapidapi.com/sandboxapidev/api/sandboxapi). Its Basic plan currently includes 500 executions per month with no credit card required. Provider quotas and pricing can change, so check the provider page before deployment.

Subscribe to SandboxAPI on RapidAPI, copy the generated `X-RapidAPI-Key`, then open **Settings** and select **Save & verify key**. FlowToCode checks the live language list for Python, C, and Java before keeping the key in server memory for the current session. The key is never returned to the browser after it is saved.

For an optional persistent deployment fallback, configure:

```dotenv
SANDBOXAPI_KEY=your_rapidapi_key
```

`SANDBOXAPI_KEY` stays on the Next.js server and is used only when no temporary Settings key is active. Do not prefix it with `NEXT_PUBLIC_` or commit `.env.local`. After changing the environment value, restart the development server.

The app applies its own request-size, timeout, concurrency, and rate limits before calling SandboxAPI. These controls protect your quota and server, but SandboxAPI remains a third-party service. Review its data handling and limits before sending sensitive code or input.

The analysis and AI tutor work without SandboxAPI. If neither Settings nor `SANDBOXAPI_KEY` provides a key, only the **Run code** feature is unavailable.

## Start the app

Development mode:

```powershell
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Production check and start:

```powershell
npm run lint
npm run build
npm run start
```

## Usage flow

1. Open [`/settings`](http://localhost:3000/settings), submit a Google AI Studio API key, select a compatible model, and connect SandboxAPI with your RapidAPI key.
2. Upload a PNG, JPEG, or WebP flowchart (up to 12 MB).
3. Select **Analyze with Gemini**. Gemini traces the shapes, arrows, branches, and loops.
4. Review the title, summary, ordered steps, assumptions, complexity, and confidence. AI output can be wrong, so check ambiguous diagrams before using the code.
5. Switch between the Python, C, and Java tabs to inspect or edit each complete program.
6. Add standard input and select **Run code**. The program is sent to the configured isolated runner, and its output and exit status appear in the website.
7. Ask the AI tutor questions about the current interpretation or selected language. The tutor uses the current code and the recent conversation as context.

## Environment reference

| Variable | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | No if configured in Settings | Persistent server-side Google AI Studio key fallback used for analysis and chat |
| `GEMINI_MODEL` | No | Server-side default/fallback model; defaults to `gemini-3.7-flash` |
| `SANDBOXAPI_KEY` | No if configured in Settings | Persistent server-side RapidAPI key fallback for SandboxAPI code execution |

## Keeping credentials out of Git

- Local environment files are ignored; only `.env.example` is committed, and it contains placeholders.
- Gemini and SandboxAPI keys entered in Settings are held in server memory for the current process. They are not written to the repository or returned to the browser.
- Keep all API keys server-side. Never use a `NEXT_PUBLIC_` prefix for a credential.
- Before committing, run `git status --short` and confirm that no private configuration file is listed.
- If a real key is ever committed or shared publicly, revoke and replace it immediately. Adding the file to `.gitignore` does not remove a secret from existing Git history.

## Troubleshooting

- **“Gemini is not configured”** — submit a key in Settings, or check `GEMINI_API_KEY` in `.env.local` and restart Next.js.
- **A Settings key disappeared** — Settings configuration lasts only for the current server process/session; submit it again after a restart or use the environment fallback.
- **Model not found or access denied** — refresh the models in Settings and choose one returned by Google, or verify that the fallback `GEMINI_MODEL` is available to the project associated with the environment key.
- **“Code runner is not configured”** — open Settings and connect SandboxAPI, or add `SANDBOXAPI_KEY` to `.env.local` and restart the app.
- **SandboxAPI authentication or quota error** — confirm the RapidAPI subscription is active, replace the key in Settings, and check the account’s monthly usage.
- **Runner HTTP or timeout error** — check SandboxAPI status, the app server’s network access, and the submitted program’s input requirements.
- **Wrong result from an unclear chart** — inspect the listed assumptions and confidence, then upload a sharper, tightly cropped image with readable branch labels.

## Privacy note

Uploaded flowcharts and tutor context are sent to Google Gemini for processing. Keys submitted through Settings are kept server-side for the current process/session and are not returned to the browser after submission. Generated code and standard input are sent to SandboxAPI through RapidAPI when you select **Run code**. Do not upload secrets, personal data, proprietary diagrams, or sensitive input unless your Google, RapidAPI, and SandboxAPI configurations are approved for that data.
