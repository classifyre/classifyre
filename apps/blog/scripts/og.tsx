/**
 * Writes the social cards to `public/og/` before `next build`.
 *
 * They are files with a `.png` extension rather than Next's
 * `opengraph-image` routes: a static export serves those without an
 * extension, and a static host then guesses the content type. Pages point
 * at these files through `ogImage()` in `lib/og-image.ts`.
 *
 * Run: bun scripts/og.tsx (the `prebuild` script does).
 */
import fs from "node:fs";
import path from "node:path";

import { TOPIC_IDS, getTopic } from "@/content/topics";
import { renderOg } from "@/lib/og";
import { ogImageName } from "@/lib/og-image";

const KICKER = { en: "Open-source data access governance", de: "Open Source · Datenzugriff steuern" };

const cards: { name: string; title: string; kicker: string }[] = [
  { name: ogImageName("en", "home"), title: "Your access rules,\nenforced on every query.", kicker: KICKER.en },
  { name: ogImageName("de", "home"), title: "Ihr Berechtigungskonzept.\nBei jeder Abfrage durchgesetzt.", kicker: KICKER.de },
  { name: ogImageName("en", "incident-response"), title: "When something leaks,\nwork it as a case.", kicker: KICKER.en },
  { name: ogImageName("de", "incident-response"), title: "Wenn etwas abfließt,\nals Fall bearbeiten.", kicker: KICKER.de },
];

for (const locale of ["en", "de"] as const) {
  for (const id of TOPIC_IDS) {
    cards.push({
      name: ogImageName(locale, id),
      title: getTopic(locale, id).name,
      kicker: KICKER[locale],
    });
  }
}

const outDir = path.join(process.cwd(), "public", "og");
fs.mkdirSync(outDir, { recursive: true });

for (const card of cards) {
  const response = renderOg(card);
  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(path.join(outDir, card.name), bytes);
  console.log(`og: ${card.name} (${Math.round(bytes.length / 1024)} KB)`);
}
