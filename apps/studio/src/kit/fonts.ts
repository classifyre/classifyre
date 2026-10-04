import type { CSSProperties } from "react";
import { loadFont as loadSerif } from "@remotion/google-fonts/ArchivoBlack";
import { loadFont as loadMono } from "@remotion/google-fonts/IBMPlexMono";
import { loadFont as loadSans } from "@remotion/google-fonts/IBMPlexSans";
import { loadFont as loadHero } from "@remotion/google-fonts/LeagueGothic";

/*
 * The same four families, weights and subsets as apps/web/app/[locale]/layout.tsx.
 * The web app gets them from next/font, which does not exist here, so this is
 * the one thing the studio has to restate — keep the two lists in step.
 */
const serif = loadSerif("normal", { weights: ["400"], subsets: ["latin"] });
const sans = loadSans("normal", {
  weights: ["400", "500", "600", "700"],
  subsets: ["latin"],
});
const mono = loadMono("normal", {
  weights: ["400", "500", "600"],
  subsets: ["latin"],
});
const hero = loadHero("normal", { weights: ["400"], subsets: ["latin"] });

/** The variables `globals.css` reads its `font-*` utilities from. */
export const fontVariables = {
  "--font-serif": `${serif.fontFamily}, serif`,
  "--font-sans": `${sans.fontFamily}, sans-serif`,
  "--font-mono": `${mono.fontFamily}, monospace`,
  "--font-hero": `${hero.fontFamily}, sans-serif`,
} as CSSProperties;
