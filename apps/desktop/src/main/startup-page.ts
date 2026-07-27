// The startup window's entire view: markup, design tokens, and the render
// function the main process drives. Kept free of Electron imports so the page
// can be rendered and inspected on its own (see
// scripts/preview-startup-window.mjs).
import {
  ARCHIVO_BLACK_WOFF2,
  LOGO_PNG,
  PLEX_MONO_WOFF2,
  PLEX_SANS_WOFF2,
} from './startup-assets.js';

/** Ordered boot phases, rendered as a checklist. */
export const STARTUP_STEPS = [
  { id: 'database', label: 'Starting the local database' },
  { id: 'runtime', label: 'Preparing bundled components' },
  { id: 'service', label: 'Starting the Classifyre service' },
  { id: 'interface', label: 'Loading the interface' },
] as const;

export type StartupStep = (typeof STARTUP_STEPS)[number]['id'];

const STEP_ITEMS = STARTUP_STEPS.map(
  (step) => `<li data-step="${step.id}"><span class="mark"></span><span>${step.label}</span></li>`,
).join('');

// Design tokens mirror packages/ui/src/styles/globals.css (the brutalist
// system: hard black/off-white, acid-green accent, 2px borders with offset
// shadows, 0.25rem radius) and the type stack from apps/web/app/layout.tsx.
// Light and dark both track the OS, matching next-themes' `defaultTheme:
// "system"` in the web app.
export const STARTUP_HTML = `
<meta charset="utf-8">
<title>Starting Classifyre</title>
<style>
  @font-face {
    font-family: "Archivo Black"; font-style: normal; font-weight: 400;
    src: url(data:font/woff2;base64,${ARCHIVO_BLACK_WOFF2}) format("woff2");
  }
  @font-face {
    font-family: "IBM Plex Sans"; font-style: normal; font-weight: 100 900;
    src: url(data:font/woff2;base64,${PLEX_SANS_WOFF2}) format("woff2");
  }
  @font-face {
    font-family: "IBM Plex Mono"; font-style: normal; font-weight: 400;
    src: url(data:font/woff2;base64,${PLEX_MONO_WOFF2}) format("woff2");
  }

  :root {
    color-scheme: light dark;
    --background: #f5f5f5;
    --foreground: #0a0a0a;
    --muted-foreground: #3a3a3a;
    --border: #0a0a0a;
    --accent: #b7ff00;
    --accent-foreground: #0a0a0a;
    --destructive: #ff2b2b;
    --radius: 0.25rem;
    --grid: 12%;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --background: #0a0a0a;
      --foreground: #f5f5f5;
      --muted-foreground: #bfbfbf;
      --border: #f5f5f5;
      /* Accent lines read hotter on black — pull them back. */
      --grid: 7%;
    }
  }

  * { box-sizing: border-box; }
  body {
    margin: 0; height: 100vh; overflow: hidden;
    display: flex; flex-direction: column;
    font-family: "IBM Plex Sans", system-ui, sans-serif;
    font-size: 13px; line-height: 1.45;
    background: var(--background); color: var(--foreground);
    user-select: none; cursor: default;
  }
  /* The landing page's accent grid, same 42px rhythm — texture, not decoration. */
  body::before {
    content: ""; position: fixed; inset: 0; pointer-events: none;
    background-image:
      linear-gradient(to right, color-mix(in srgb, var(--accent) var(--grid), transparent) 1px, transparent 1px),
      linear-gradient(to bottom, color-mix(in srgb, var(--accent) var(--grid), transparent) 1px, transparent 1px);
    background-size: 42px 42px;
  }

  header {
    display: flex; align-items: center; gap: 12px;
    padding: 14px 22px; border-bottom: 2px solid var(--border);
  }
  #logo {
    width: 38px; height: 38px; flex: none;
    border-radius: var(--radius); object-fit: cover;
  }
  #name {
    font-family: "Archivo Black", system-ui, sans-serif;
    font-size: 14px; letter-spacing: .08em; text-transform: uppercase;
  }
  #kicker {
    font-family: "IBM Plex Mono", ui-monospace, monospace;
    font-size: 10px; letter-spacing: .14em; text-transform: uppercase;
    color: var(--muted-foreground);
  }

  main {
    position: relative; flex: 1; min-height: 0;
    display: flex; flex-direction: column; gap: 16px;
    padding: 20px 22px 18px;
  }
  h1 {
    margin: 0;
    font-family: "Archivo Black", system-ui, sans-serif; font-weight: 400;
    font-size: 27px; line-height: 1; letter-spacing: .03em; text-transform: uppercase;
  }

  #track {
    height: 12px; border: 2px solid var(--border); border-radius: 2px;
    padding: 1px; overflow: hidden;
  }
  #bar {
    height: 100%; width: 6%; background: var(--accent);
    transition: width .4s cubic-bezier(.2,.8,.2,1);
    /* Hatching keeps the bar visibly alive during the long service step. */
    background-image: repeating-linear-gradient(
      45deg, rgba(10,10,10,.22) 0 5px, transparent 5px 10px);
    background-size: 14.14px 14.14px;
    animation: hatch .55s linear infinite;
  }
  @keyframes hatch { to { background-position: 14.14px 0; } }

  ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; }
  li {
    display: flex; align-items: center; gap: 10px;
    padding: 4px 8px; border-left: 2px solid transparent;
    font-size: 11.5px; font-weight: 600; letter-spacing: .06em;
    text-transform: uppercase; color: var(--muted-foreground);
  }
  li[data-state="active"] {
    color: var(--foreground);
    border-left-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  li[data-state="pending"] { opacity: .45; }
  .mark {
    position: relative; width: 12px; height: 12px; flex: none;
    border: 2px solid currentColor; border-radius: 1px;
  }
  li[data-state="active"] .mark {
    border-color: var(--accent); background: var(--accent);
    animation: blink 1s steps(1, end) infinite;
  }
  @keyframes blink { 50% { background: transparent; } }
  li[data-state="done"] .mark { border-color: var(--accent); background: var(--accent); }
  /* CSS-drawn tick: no glyph, so it can't fall back to tofu. */
  li[data-state="done"] .mark::after {
    content: ""; position: absolute; left: 1px; top: -1px;
    width: 4px; height: 7px; transform: rotate(42deg);
    border-right: 2px solid var(--accent-foreground);
    border-bottom: 2px solid var(--accent-foreground);
  }

  #detail, #hint, #log {
    font-family: "IBM Plex Mono", ui-monospace, monospace;
    font-size: 10.5px; line-height: 1.5; color: var(--muted-foreground);
    overflow-wrap: anywhere;
  }
  #detail { margin-top: auto; }
  #hint { display: none; border-left: 2px solid var(--accent); padding-left: 8px; }
  #hint.visible { display: block; }

  #error { display: none; }
  body.failed #steps, body.failed #track, body.failed #detail, body.failed #hint { display: none; }
  body.failed h1 { color: var(--destructive); }
  body.failed #error {
    display: flex; flex-direction: column; gap: 8px; min-height: 0;
    /* A long failure message scrolls inside its panel, never clips. */
    overflow-y: auto;
    padding: 12px; border: 2px solid var(--destructive); border-radius: var(--radius);
    box-shadow: 4px 4px 0 0 var(--destructive);
  }
  #message { white-space: pre-wrap; overflow-wrap: anywhere; }

  /* One short, staggered reveal on open — the window appears within a frame of
     launch, so this is the app's first impression. */
  @keyframes enter { from { opacity: 0; transform: translateY(5px); } }
  header, h1, #track, li { animation: enter .34s ease-out both; }
  h1 { animation-delay: .05s; }
  #track { animation-delay: .1s; }
  li:nth-child(1) { animation-delay: .15s; }
  li:nth-child(2) { animation-delay: .2s; }
  li:nth-child(3) { animation-delay: .25s; }
  li:nth-child(4) { animation-delay: .3s; }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation: none !important;
      transition: none !important;
    }
  }
</style>
<header>
  <img id="logo" alt="" src="data:image/png;base64,${LOGO_PNG}">
  <div>
    <div id="name">Classifyre</div>
    <div id="kicker">System startup</div>
  </div>
</header>
<main>
  <h1 id="title">Starting up</h1>
  <div id="track"><div id="bar"></div></div>
  <ul id="steps">${STEP_ITEMS}</ul>
  <div id="detail"></div>
  <div id="hint">First launch takes a few minutes while bundled components are prepared. You can leave this window open.</div>
  <div id="error"><div id="message"></div><div id="log"></div></div>
</main>
`;

// Defined after load rather than inline in the page, so the markup above stays
// script-free (same approach as the update progress window).
export const STARTUP_BOOTSTRAP = `
window.__startup = (state) => {
  const steps = ${JSON.stringify(STARTUP_STEPS.map((step) => step.id))};
  if (state.title !== undefined) document.getElementById('title').textContent = state.title;
  if (state.detail !== undefined) document.getElementById('detail').textContent = state.detail;
  if (state.step !== undefined) {
    const active = steps.indexOf(state.step);
    for (const [index, id] of steps.entries()) {
      const li = document.querySelector('[data-step="' + id + '"]');
      if (li) li.dataset.state = index < active ? 'done' : index === active ? 'active' : 'pending';
    }
    // Reserve the last slice for the step in flight — never render 100% while
    // the app is still working.
    document.getElementById('bar').style.width =
      Math.round(((active + 0.5) / steps.length) * 100) + '%';
    // A step that overruns gets the "this is normal" hint instead of silence.
    clearTimeout(window.__hintTimer);
    document.getElementById('hint').classList.remove('visible');
    window.__hintTimer = setTimeout(
      () => document.getElementById('hint').classList.add('visible'),
      ${20_000},
    );
  }
  if (state.error !== undefined) {
    clearTimeout(window.__hintTimer);
    document.body.classList.add('failed');
    document.getElementById('message').textContent = state.error;
    document.getElementById('log').textContent = state.log ? 'Log file: ' + state.log : '';
  }
};
// executeJavaScript resolves with the script's completion value, which must be
// structured-cloneable — without this the value would be the function above and
// the call would reject with "An object could not be cloned".
true;
`;
