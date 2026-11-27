import { NextResponse, type NextRequest } from "next/server";
import de from "@/i18n/de.json";
import en from "@/i18n/en.json";
import { checkDeploymentReadiness } from "@/lib/iam/readiness";
import { safeReturnTo } from "@/lib/iam/session";
import { LANGUAGE_COOKIE } from "@/lib/language-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEXT = { en: en.startingPage, de: de.startingPage } as const;

/**
 * Shown while a fresh deployment or restart is still preparing the API,
 * identity server, initial tenant, or first-run workspace. Polls `/auth/ready/`
 * every two seconds and refreshes straight into the requested page as soon as
 * everything is ready.
 *
 * Self-contained HTML outside the React tree (like `/auth/no-tenant/`) so it
 * renders reliably even before the API or identity server answers.
 */
export async function GET(request: NextRequest) {
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"));
  const status = await checkDeploymentReadiness();

  if (status.ready) {
    return NextResponse.redirect(new URL(returnTo, request.url), {
      status: 307,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const langCookie = request.cookies.get(LANGUAGE_COOKIE)?.value?.toLowerCase();
  const isGerman =
    langCookie === "de" ||
    (!langCookie &&
      request.headers.get("accept-language")?.toLowerCase().startsWith("de"));
  const t = isGerman ? TEXT.de : TEXT.en;
  const lang = isGerman ? "de" : "en";

  const showTrialLogin =
    process.env.CLASSIFYRE_ALLINONE === "1" &&
    process.env.CLASSIFYRE_ADMIN_USER === "admin" &&
    process.env.CLASSIFYRE_ADMIN_PASSWORD === "admin";

  const workspaceReady = status.checks.tenant && status.checks.bootstrap;

  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<noscript><meta http-equiv="refresh" content="5"></noscript>
<title>${escapeHtml(t.title)} · Classifyre</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f6f5f2;
    --card: #ffffff;
    --fg: #141414;
    --muted: #5a5a56;
    --line: #d6d4ce;
    --border-strong: #141414;
    --accent: #b7ff00;
    --accent-ink: #141414;
    --done: #15803d;
    --track: #e6e4de;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #111111;
      --card: #191919;
      --fg: #f0f0ec;
      --muted: #a1a19c;
      --line: #2e2e2c;
      --border-strong: #f0f0ec;
      --accent: #b7ff00;
      --accent-ink: #111111;
      --done: #4ade80;
      --track: #262624;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    background: var(--bg);
    color: var(--fg);
    font: 15px/1.55 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    padding: 1.25rem;
  }
  main {
    width: 100%;
    max-width: 31rem;
    background: var(--card);
    border: 2px solid var(--border-strong);
    padding: 2rem;
    box-shadow: 6px 6px 0 0 var(--border-strong);
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: .5rem;
    font: 700 11px/1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    letter-spacing: .16em;
    text-transform: uppercase;
    padding: .35rem .6rem;
    background: var(--accent);
    color: var(--accent-ink);
    margin-bottom: 1.15rem;
  }
  .pulse {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
    animation: pulse 1.2s ease-in-out infinite;
  }
  h1 {
    margin: 0 0 .5rem;
    font-size: 1.5rem;
    line-height: 1.2;
    letter-spacing: -.01em;
  }
  .lead {
    margin: 0 0 1.25rem;
    color: var(--muted);
  }
  .bar {
    position: relative;
    height: 4px;
    background: var(--track);
    overflow: hidden;
    margin-bottom: 1.25rem;
  }
  .bar::after {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    width: 38%;
    background: var(--border-strong);
    animation: slide 1.5s cubic-bezier(.4, 0, .2, 1) infinite;
  }
  ul.steps {
    list-style: none;
    margin: 0 0 1.25rem;
    padding: 0;
    border-top: 1px solid var(--line);
  }
  ul.steps li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: .75rem;
    padding: .65rem 0;
    border-bottom: 1px solid var(--line);
    font-size: .92rem;
  }
  .step-label {
    display: flex;
    align-items: center;
    gap: .6rem;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 2px solid var(--muted);
    flex-shrink: 0;
  }
  li[data-ready="true"] .dot {
    background: var(--done);
    border-color: var(--done);
  }
  li[data-ready="false"] .dot {
    border-color: var(--fg);
    border-top-color: transparent;
    animation: spin .85s linear infinite;
  }
  .step-state {
    font: 600 11px/1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    text-transform: uppercase;
    letter-spacing: .08em;
    color: var(--muted);
  }
  li[data-ready="true"] .step-state { color: var(--done); }
  .hint {
    margin: 0 0 1rem;
    font-size: .86rem;
    color: var(--muted);
  }
  .trial {
    margin: 0 0 1.25rem;
    padding: .75rem .9rem;
    border: 1px solid var(--line);
    background: var(--bg);
    font-size: .86rem;
  }
  .trial code {
    font: 600 .9em/1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    padding: .1rem .3rem;
    border: 1px solid var(--line);
    background: var(--card);
  }
  .footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: .75rem;
    flex-wrap: wrap;
    padding-top: .25rem;
  }
  .status-line {
    font-size: .82rem;
    color: var(--muted);
  }
  button {
    padding: .45rem .9rem;
    border: 2px solid var(--border-strong);
    background: transparent;
    color: var(--fg);
    font: 600 .82rem/1.2 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    text-transform: uppercase;
    letter-spacing: .08em;
    cursor: pointer;
  }
  button:hover {
    background: var(--border-strong);
    color: var(--bg);
  }
  @keyframes slide {
    0% { transform: translateX(-110%); }
    100% { transform: translateX(300%); }
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: .25; }
  }
</style>
</head>
<body>
<main>
  <div class="badge"><span class="pulse" aria-hidden="true"></span>Classifyre</div>
  <h1>${escapeHtml(t.title)}</h1>
  <p class="lead">${escapeHtml(t.description)}</p>
  <div class="bar" role="progressbar" aria-label="${escapeHtml(t.title)}"></div>
  <ul class="steps">
    <li id="step-api" data-ready="${String(status.checks.api)}">
      <span class="step-label"><span class="dot" aria-hidden="true"></span>${escapeHtml(t.stepApi)}</span>
      <span class="step-state">${escapeHtml(status.checks.api ? t.stateReady : t.stateWaiting)}</span>
    </li>
    <li id="step-iam" data-ready="${String(status.checks.iam)}">
      <span class="step-label"><span class="dot" aria-hidden="true"></span>${escapeHtml(t.stepIam)}</span>
      <span class="step-state">${escapeHtml(status.checks.iam ? t.stateReady : t.stateWaiting)}</span>
    </li>
    <li id="step-workspace" data-ready="${String(workspaceReady)}">
      <span class="step-label"><span class="dot" aria-hidden="true"></span>${escapeHtml(t.stepWorkspace)}</span>
      <span class="step-state">${escapeHtml(workspaceReady ? t.stateReady : t.stateWaiting)}</span>
    </li>
  </ul>
  <p class="hint">${escapeHtml(t.firstBootNote)}</p>
  ${
    showTrialLogin
      ? `<p class="trial">${escapeHtml(t.trialLoginPrefix)} <code>admin</code> / <code>admin</code> ${escapeHtml(t.trialLoginSuffix)}</p>`
      : ""
  }
  <div class="footer">
    <span id="status-line" class="status-line" aria-live="polite">${escapeHtml(t.polling)}</span>
    <button id="check-now" type="button">${escapeHtml(t.checkNow)}</button>
  </div>
</main>
<script>
(function () {
  var returnTo = ${JSON.stringify(returnTo)};
  var readyLabel = ${JSON.stringify(t.stateReady)};
  var waitingLabel = ${JSON.stringify(t.stateWaiting)};
  var readyRedirect = ${JSON.stringify(t.redirecting)};
  var pollingLabel = ${JSON.stringify(t.polling)};
  var statusLine = document.getElementById("status-line");
  var button = document.getElementById("check-now");
  var timer = null;
  var inFlight = false;

  function setStep(id, ready) {
    var el = document.getElementById(id);
    if (!el) return;
    el.setAttribute("data-ready", ready ? "true" : "false");
    var state = el.querySelector(".step-state");
    if (state) state.textContent = ready ? readyLabel : waitingLabel;
  }

  function finish() {
    if (statusLine) statusLine.textContent = readyRedirect;
    if (window.location.pathname.indexOf("/auth/starting") === 0) {
      window.location.replace(returnTo);
    } else {
      window.location.reload();
    }
  }

  function poll() {
    if (inFlight) return;
    inFlight = true;
    fetch("/auth/ready/", { cache: "no-store", credentials: "same-origin" })
      .then(function (res) {
        return res.json().catch(function () { return null; }).then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (result.data && result.data.checks) {
          var c = result.data.checks;
          setStep("step-api", Boolean(c.api));
          setStep("step-iam", Boolean(c.iam));
          setStep("step-workspace", Boolean(c.tenant && c.bootstrap));
        }
        if (result.ok && result.data && result.data.ready) {
          finish();
          return;
        }
        if (statusLine) statusLine.textContent = pollingLabel;
        timer = window.setTimeout(poll, 2000);
      })
      .catch(function () {
        timer = window.setTimeout(poll, 2500);
      })
      .finally(function () {
        inFlight = false;
      });
  }

  if (button) {
    button.addEventListener("click", function () {
      if (timer) window.clearTimeout(timer);
      poll();
    });
  }

  timer = window.setTimeout(poll, 2000);
})();
</script>
</body>
</html>`;

  return new NextResponse(html, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": "3",
    },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
