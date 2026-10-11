import type { ComponentType } from "react";
// The landing page's own stylesheet: its type, its string boards, its stamps.
import "../../../blog/app/landing.css";

/*
 * Components of the marketing site, filmed where they live (README.md here
 * says how and why `require.context`). What each one takes is restated, and
 * only as much of it as a video uses.
 */

const blogLanding = require.context(
  "../../../blog/components/landing",
  false,
  /hero\.tsx$/,
);
/** The landing page's first screen: headline, exhibit card, install strip. */
export const { Hero } = blogLanding<{
  Hero: ComponentType<{ locale: "en" | "de" }>;
}>("./hero.tsx");
