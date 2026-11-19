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

const KICKER = { en: "Open-source data governance", de: "Open-Source-Data-Governance" };

const cards: { name: string; title: string; kicker: string }[] = [
  { name: ogImageName("en", "home"), title: "Find it. Protect it.\nUse it.", kicker: KICKER.en },
  { name: ogImageName("de", "home"), title: "Finden. Schützen.\nNutzen.", kicker: KICKER.de },
  {
    name: ogImageName("en", "editions"),
    title: "All of it is open source",
    kicker: "Open source and Enterprise",
  },
  {
    name: ogImageName("de", "editions"),
    title: "Alles ist Open Source",
    kicker: "Open Source und Enterprise",
  },
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
