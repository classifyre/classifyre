/* global process */
/* eslint-disable turbo/no-undeclared-env-vars */
// Screenshots of the running app for the film (viewport-sized, at three times the size). Not committed.
//   copy into apps/web (Playwright lives there), then: node capture.mjs <out-dir> [3]
import { chromium } from "playwright";
const [out, dpr = "3"] = process.argv.slice(2);
const BASE = "http://localhost:3000/en/whole-drive";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1483, height: 707 }, deviceScaleFactor: Number(dpr), colorScheme: "dark" });
const page = await context.newPage();
const HIDE = "nextjs-portal, [data-nextjs-toast], [data-next-badge-root] { display: none !important; } * { caret-color: transparent !important; }";

async function open(url) {
  await page.goto(BASE + url, { waitUntil: "networkidle" }).catch(() => {});
  // A page that redirects (a trailing slash, a tab in the URL) navigates once more.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.waitForTimeout(2500);
    try {
      await page.addStyleTag({ content: HIDE });
      break;
    } catch {
      // navigated meanwhile: wait and try again
    }
  }
  console.log("at", page.url());
}
/** Scrolls whatever scrolls so that the element holding `text` sits `offset` px under the top. */
async function bring(text, offset = 80, exact = true) {
  const done = await page.evaluate(({ text, offset, exact }) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node, el = null;
    while ((node = walker.nextNode())) {
      const t = node.textContent.trim();
      if (exact ? t.toLowerCase() === text.toLowerCase() : t.toLowerCase().includes(text.toLowerCase())) { el = node.parentElement; break; }
    }
    if (!el) return "not found: " + text;
    let box = el;
    while (box && box !== document.body) {
      const s = getComputedStyle(box);
      if (/(auto|scroll)/.test(s.overflowY) && box.scrollHeight > box.clientHeight + 4) break;
      box = box.parentElement;
    }
    const top = el.getBoundingClientRect().top;
    if (box && box !== document.body) { box.scrollTop += top - box.getBoundingClientRect().top - offset; return "scrolled " + box.tagName; }
    window.scrollTo(0, window.scrollY + top - offset); return "scrolled window";
  }, { text, offset, exact });
  await page.waitForTimeout(600);
  return done;
}
/** Where an element holding `text` is on the page, for the film's marks. */
async function where(text, exact = false) {
  return page.evaluate(({ text, exact }) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const t = node.textContent.trim();
      if (exact ? t === text : t.includes(text)) {
        const r = node.parentElement.getBoundingClientRect();
        if (r.width && r.top >= 0 && r.top < 707) return { text, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      }
    }
    return { text, missing: true };
  }, { text, exact });
}
const shot = async (name, marks = []) => {
  await page.screenshot({ path: `${out}/${name}.png` });
  const found = [];
  for (const mark of marks) found.push(await where(mark));
  console.log("shot", name, JSON.stringify(found));
};


const only = process.argv.slice(4);
const wanted = (name) => !only.length || only.includes(name);

// Where the model is chosen: Harness AI -> Embedding.
if (wanted("settings")) {
  await open("/harness/?tab=embedding");
  console.log(await bring("Model", 90));
  await shot("settings-model", ["Model", "Pictures", "Sound"]);
  console.log(await bring("Corpus", 60));
  await shot("settings-corpus", ["Vectors", "Text chunks"]);
}

// The duplicate review queue, and its tuning screen.
if (wanted("duplicates")) {
  await open("/duplicates/");
  await shot("duplicates-queue", ["Shared values", "Repeated text", "Identical content"]);
  await open("/duplicates/tune/");
  console.log(await bring("iban", 220, false));
  await shot("duplicates-tune", ["iban_code", "phone_number", "person"]);
}

// One pair, with the values that linked it: given as a path on the command line.
const pair = process.env.PAIR;
if (pair && wanted("pair")) {
  await open(pair);
  await shot("pair-values", ["IBAN", "phone", "Shared"]);
}

// The assets list, asked by meaning.
const ask = process.env.ASK;
if (ask && wanted("search")) {
  await open("/assets/");
  const box = page.locator("main input[type=text], main input:not([type])").first();
  await box.click();
  await box.fill(ask);
  await page.waitForTimeout(6000);
  await shot(process.env.ASK_NAME ?? "search", []);
}

await browser.close();
