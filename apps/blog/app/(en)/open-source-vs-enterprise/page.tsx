import type { Metadata } from "next";

import { EditionsPage } from "@/components/editions";

import "../../landing.css";

/**
 * /open-source-vs-enterprise (English). Metadata and structured data live
 * here; the page itself is the shared `<EditionsPage>` so both locales ship
 * the same composition.
 */

export const metadata: Metadata = {
  title: "Open Source vs Enterprise: Same Engine, Different Room",
  description:
    "A plain comparison of Classifyre's open-source core and the enterprise layer. Every detection, investigation and deployment feature is open source; enterprise adds SSO, roles, per-workspace authorization, tuned models and SLA-backed support.",
  alternates: {
    canonical: "/open-source-vs-enterprise/",
    languages: {
      en: "/open-source-vs-enterprise/",
      de: "/de/open-source-vs-enterprise/",
      "x-default": "/open-source-vs-enterprise/",
    },
  },
  openGraph: {
    title: "Classifyre: Open Source vs Enterprise",
    description:
      "Detection, investigations, autopilot and both runtimes are open source. Enterprise adds the governance layer and our engineers.",
    type: "website",
  },
};

export default function EditionsRoute() {
  return <EditionsPage locale="en" />;
}
