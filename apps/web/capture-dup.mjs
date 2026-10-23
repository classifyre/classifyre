/* global process */
// Screenshots of the running app for the film, and the clicks between them. Not committed.
//   cp capture.mjs ../../../../../web/capture-dup.mjs && cd apps/web && node capture-dup.mjs <out-dir> <step> [dpr]
// Steps change the workspace (verdicts, exclusions, weights); run them in the order of the film.
import { chromium } from "playwright";

const [out, step, dpr = "3"] = process.argv.slice(2);
const BASE = "http://localhost:3000/whole-drive";
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1483, height: 707 },
  deviceScaleFactor: Number(dpr),
  colorScheme: "dark",
});
const page = await context.newPage();
const HIDE =
  "nextjs-portal, [data-nextjs-toast], [data-next-badge-root], [data-sonner-toaster] { display: none !important; } * { caret-color: transparent !important; }";

async function open(url) {
  await page.goto(BASE + url, { waitUntil: "networkidle" }).catch(() => {});
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.waitForTimeout(2500);
    try {
      await page.addStyleTag({ content: HIDE });
      break;
    } catch {
      // navigated meanwhile
    }
  }
  console.log("at", page.url());
}

/** Scrolls whatever scrolls so that the element holding `text` sits `offset` px under the top. */
async function bring(text, offset = 80, exact = true) {
  const done = await page.evaluate(
    ({ text, offset, exact }) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      let el = null;
      while ((node = walker.nextNode())) {
        const t = node.textContent.trim().toLowerCase();
        if (exact ? t === text.toLowerCase() : t.includes(text.toLowerCase())) {
          el = node.parentElement;
          break;
        }
      }
      if (!el) return "not found: " + text;
      let box = el;
      while (box && box !== document.body) {
        const s = getComputedStyle(box);
        if (/(auto|scroll)/.test(s.overflowY) && box.scrollHeight > box.clientHeight + 4) break;
        box = box.parentElement;
      }
      const top = el.getBoundingClientRect().top;
      if (box && box !== document.body) {
        box.scrollTop += top - box.getBoundingClientRect().top - offset;
        return "scrolled " + box.tagName;
      }
      window.scrollTo(0, window.scrollY + top - offset);
      return "scrolled window";
    },
    { text, offset, exact },
  );
  await page.waitForTimeout(700);
  return done;
}

/** Where elements holding `text` are on the page (first visible one), for the film's marks. */
async function where(text) {
  return page.evaluate((text) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const t = node.textContent.trim().toLowerCase();
      if (t.includes(text.toLowerCase())) {
        const r = node.parentElement.getBoundingClientRect();
        if (r.width && r.top >= 0 && r.top < 707)
          return { text, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      }
    }
    return { text, missing: true };
  }, text);
}

const shot = async (name, marks = []) => {
  await page.screenshot({ path: `${out}/${name}.png` });
  const found = [];
  for (const mark of marks) found.push(await where(mark));
  console.log("shot", name, JSON.stringify(found));
  // Kept beside the shots: the film places its boxes from these.
  const { readFileSync, writeFileSync, existsSync } = await import("node:fs");
  const file = `${out}/marks.json`;
  const all = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  all[name] = found;
  writeFileSync(file, JSON.stringify(all, null, 1));
};

const PAIR = {
  invoices: "10288b69-47e2-4133-9c54-d671da9a6b07..3dc4e60e-235c-4ce8-aa83-36b6c5e2f84f",
  hire: "03cddb53-ea37-4015-b175-de600c6c476d..cfcd280f-6a1c-478d-bb1c-ea9858ae8424",
};

const steps = {
  // The queue as it stands, then the merge cutoff pulled up to see what it was hiding.
  async queue() {
    await open("/duplicates/");
    await shot("queue-default", ["Needs your review", "pairs remaining", "Above your merge cutoff", "Duplicate rate", "WORK BY PATTERN", "MERGE"]);
    await page.locator("#merge-cutoff").fill("18");
    await page.waitForTimeout(800);
    await shot("queue-merge-090", ["Needs your review", "pairs remaining", "Above your merge cutoff", "WORK BY PATTERN", "MERGE", "Save"]);
  },
  // One pattern and one pair of the firm's own invoices.
  async invoices() {
    await open(`/duplicates/pairs/${PAIR.invoices}`);
    await shot("invoices-pair", ["MATCH WEIGHT", "iban_code", "phone_number", "Not a duplicate"]);
    await page.getByRole("button", { name: "Not a duplicate" }).click();
    await page.waitForTimeout(2500);
    await shot("invoices-cause", ["What made these match", "gb75qxhb40127655120983", "in 8 documents", "Stop matching on these values", "other pairs"]);
  },
  // Reject the invoices pair and stop matching on the firm's own values.
  async exclude() {
    await open(`/duplicates/pairs/${PAIR.invoices}`);
    await page.getByRole("button", { name: "Not a duplicate" }).click();
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: "Stop matching on these values" }).click();
    await page.waitForTimeout(4000);
    await shot("invoices-after-reject", ["MATCH WEIGHT"]);
  },
  // The queue after the firm's own values stopped counting, merge cutoff still up.
  async afterExclude() {
    await open("/duplicates/");
    await page.locator("#merge-cutoff").fill("18");
    await page.waitForTimeout(800);
    await shot("queue-after-exclude", ["Needs your review", "pairs remaining", "Repeated text", "WORK BY PATTERN"]);
  },
  // The invoice template, found by meaning: record its pairs as not duplicates.
  async template() {
    const portfolio = await (await fetch(`${BASE.replace("/whole-drive", "")}/api/whole-drive/correlation/review/portfolio/`)).json();
    const key = portfolio.patterns
      .filter((p) => p.patternKey.startsWith("boilerplate:"))
      .sort((a, b) => b.pairCount - a.pairCount)[0].patternKey;
    await open(`/duplicates/patterns/${encodeURIComponent(key)}`);
    await shot("template-pattern", ["RULE CANDIDATE", "Repeated text", "Stop matching on these values", "Pairs to review"]);
    await page.getByRole("button", { name: "Stop matching on these values" }).first().click();
    await page.waitForTimeout(2500);
    await shot("template-dialog", ["Stop the template from driving matches", "Record as not duplicates", "Exclude"]);
    await page.getByRole("dialog").getByRole("button", { name: /Record as not duplicates|Exclude \d+ values/ }).click();
    await page.waitForTimeout(4000);
    await shot("template-after", ["Repeated text"]);
  },
  // Dates stop counting: weight 1 -> 0 on the tuning screen.
  async weights() {
    await open("/duplicates/tune/");
    await shot("tune-before", ["Label weights", "date_time", "iban_code", "Save & recompute", "Exclusions"]);
    await page.getByLabel("date_time", { exact: true }).fill("0");
    await page.waitForTimeout(600);
    await shot("tune-date-zero", ["date_time", "Save & recompute"]);
    await page.getByRole("button", { name: "Save & recompute" }).click();
    await page.waitForTimeout(3000);
    await shot("tune-saved", ["date_time"]);
  },
  // Cutoffs: review 0.40, merge 0.85, saved.
  async cutoffs() {
    await open("/duplicates/");
    await shot("cutoffs-before", ["Needs your review", "pairs remaining", "Above your merge cutoff", "REVIEW", "MERGE"]);
    await page.locator("#review-cutoff").fill("8");
    await page.locator("#merge-cutoff").fill("17");
    await page.waitForTimeout(800);
    await shot("cutoffs-draft", ["Needs your review", "pairs remaining", "Above your merge cutoff", "Below your review cutoff", "Save cutoffs", "WORK BY PATTERN"]);
    await page.getByRole("button", { name: "Save cutoffs" }).click();
    await page.waitForTimeout(3000);
  },
  // The supplier pair, read from the top down.
  async hire() {
    await open(`/duplicates/pairs/${PAIR.hire}`);
    await shot("hire-top", ["MATCH WEIGHT", "0.71", "left in this pattern", "LINEAGE UNKNOWN", "WXD-0031.txt", "WDH-1184.txt", "nine days", "gb53qxhb40221971830264", "02079460588", "oren fairwether", "orrin fairweather", "wexcomb dry hire ltd", "Confirm", "Not a duplicate", "Unsure, next", "Add to case", "Create inquiry watch"]);
    console.log(await bring("Why it scored", 30, false));
    await shot("hire-why", ["Why it scored", "+0.39", "+0.26", "+0.06", "MATCH WEIGHT", "PERFECT MATCH", "Linked documents", "new-supplier-request", "0.77", "0.67", "The bars add up"]);
    console.log(await bring("The values behind this match", 30));
    await shot("hire-values", ["The values behind this match", "iban_code", "weight 6", "+0.39", "Contributed", "Shared values", "phone_number", "date_time", "person", "organization", "nothing shared"]);
    await page.getByRole("button", { name: "Where else this value appears" }).first().click();
    await page.waitForTimeout(3000);
    await shot("hire-where-else", ["Where else this value appears", "4 asset", "approved-suppliers-2026.csv", "new-supplier-request-2026-09-14.txt", "Shared drive"]);
  },
  async hireCase() {
    await open(`/duplicates/pairs/${PAIR.hire}`);
    await page.getByRole("button", { name: "Add to case" }).click();
    await page.waitForTimeout(1500);
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill("Drying hire for HR-2231 invoiced twice?");
    await dialog.getByText("new-supplier-request-2026-09-14.txt").click();
    await page.waitForTimeout(600);
    await shot("hire-case-dialog", ["Assets to attach", "new-supplier-request", "Title", "Apply"]);
    await dialog.getByRole("button", { name: "Apply" }).click();
    await page.waitForTimeout(6000);
    await shot("hire-case", ["Drying hire"]);
    console.log("case at", page.url());
  },
  async hireInquiry() {
    await open(`/duplicates/pairs/${PAIR.hire}`);
    await page.getByRole("button", { name: "Create inquiry watch" }).click();
    await page.waitForTimeout(8000);
    await page.addStyleTag({ content: HIDE }).catch(() => {});
    await shot("hire-inquiry", ["Watch for what", "gb53", "Matches"]);
    console.log("inquiry at", page.url());
  },
  async casePage() {
    await open("/investigations/e008a3eb-722e-4a6b-b21e-8178e2803d2b");
    await page.waitForTimeout(4000);
    await shot("case-page", ["Drying hire", "3", "EVIDENCE", "FINDINGS", "WXD-0031.txt", "WDH-1184.txt", "new-supplier-request"]);
  },
  async decisionsNow() {
    await open("/duplicates/decisions/");
    await shot("decisions-now", ["Decisions", "Went nowhere yet", "Re-scored", "Not a duplicate"]);
  },
  // Verdicts through the pair screen's own buttons.
  async decide() {
    const confirm = [
      "03cddb53-ea37-4015-b175-de600c6c476d..cfcd280f-6a1c-478d-bb1c-ea9858ae8424",
      "03cddb53-ea37-4015-b175-de600c6c476d..7226df73-69c0-4e21-a0c5-d402082b4872",
      "7226df73-69c0-4e21-a0c5-d402082b4872..cfcd280f-6a1c-478d-bb1c-ea9858ae8424",
      "8b186e80-786b-4535-8bdd-e4cfb0f8b758..c5cc3b23-9644-4cae-96ac-9867f6b470d5",
      "122445d7-986a-4cb8-8500-3658a81346f7..ae27ab98-55ab-42fb-85e3-aff64f9e91b0",
    ];
    for (const id of confirm) {
      await open(`/duplicates/pairs/${id}`);
      await page.getByRole("button", { name: "Confirm", exact: true }).click();
      await page.waitForTimeout(2500);
    }
    await open("/duplicates/pairs/122445d7-986a-4cb8-8500-3658a81346f7..1859b0ab-b8a3-4522-ab78-27af39895a2b");
    await shot("letters-pair", ["MATCH WEIGHT", "drying-notice-HR-2238.txt", "Not a duplicate"]);
    await page.getByRole("button", { name: "Not a duplicate" }).click();
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: "Just reject" }).click();
    await page.waitForTimeout(2500);
    await open("/duplicates/pairs/74598738-0ca8-4647-8846-909a8b01e786..89300cfe-2c9a-4384-a2c5-c12b3c9ebdba");
    await shot("translation-pair", ["MATCH WEIGHT", "payment-reminder-2026-0417.txt", "Unsure, next"]);
    await page.getByRole("button", { name: "Unsure, next" }).click();
    await page.waitForTimeout(2500);
  },
  async decisions() {
    await open("/duplicates/decisions/");
    await shot("decisions-all", ["Decisions", "Went nowhere yet", "Duplicate", "Unsure", "WXD-0031.txt"]);
    await page.getByRole("button", { name: "Went nowhere yet" }).click();
    await page.waitForTimeout(2500);
    await shot("decisions-nowhere", ["Went nowhere yet", "WXD-0031.txt", "HR-2236-invoice", "drying-notice"]);
    for (const row of await page.getByRole("row").all()) {
      const text = await row.innerText();
      if (/WXD-0031|WDH-1184|new-supplier-request/.test(text)) {
        await row.getByRole("checkbox").click();
      }
    }
    await page.waitForTimeout(800);
    await shot("decisions-picked", ["selected", "Add to case", "Open inquiry", "Reopen"]);
    await page.getByRole("button", { name: /Add to case/ }).first().click();
    await page.waitForTimeout(1500);
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill("Drying hire for HR-2231 invoiced twice?");
    await page.waitForTimeout(500);
    await shot("decisions-case-dialog", ["Assets to attach", "Title", "Apply"]);
    await dialog.getByRole("button", { name: "Apply" }).click();
    await page.waitForTimeout(12000);
    console.log("now at", page.url());
    await open("/duplicates/decisions/");
    await shot("decisions-after", ["In case", "WXD-0031.txt", "not used yet"]);
  },
  async decisionsFinal() {
    await open("/duplicates/decisions/");
    await shot("decisions-final", ["Decisions", "Went nowhere yet", "Unsure", "Not a duplicate", "Duplicate", "in a case", "not used yet", "2 not used yet", "Score", "Used in"]);
    await page.getByRole("button", { name: "Went nowhere yet" }).click();
    await page.waitForTimeout(2500);
    await shot("decisions-final-nowhere", ["Went nowhere yet", "HR-2236-invoice-revised.txt", "drying-notice-HR-2231.txt", "not used yet"]);
  },
  async inquiryPage() {
    await open("/investigations/inquiries/e2249ef5-2dd2-4521-a533-e4283bb1e6a9");
    await page.waitForTimeout(3000);
    await shot("hire-inquiry", ["Watch for what", "Watches for", "Matches", "8"]);
  },
  async finalQueue() {
    await open("/duplicates/");
    await shot("queue-final", ["Needs your review", "73", "pairs remaining", "Above your merge cutoff", "Needs your review", "Below your review cutoff", "WORK BY PATTERN", "Duplicate rate", "REVIEW", "0.40", "0.85", "Repeated text"]);
  },
  async tuneFinal() {
    await open("/duplicates/tune/");
    console.log(await bring("Label weights", 30));
    await shot("tune-final-top", ["Label weights", "date_time", "iban_code", "Exclusions"]);
    await page.evaluate(() => {
      const list = [...document.querySelectorAll("div")].find((d) => String(d.className).includes("max-h-72"));
      const row = [...(list?.querySelectorAll("span") ?? [])].find((el) => el.textContent?.trim() === "location");
      if (list && row) list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top - 4;
    });
    await page.waitForTimeout(500);
    await shot("tune-final", ["Label weights", "person", "date_time", "Exclusions", "iban_code", "Save & recompute"]);
  },
};

if (!steps[step]) {
  console.log("steps:", Object.keys(steps).join(", "));
} else {
  await steps[step]();
}
await browser.close();
