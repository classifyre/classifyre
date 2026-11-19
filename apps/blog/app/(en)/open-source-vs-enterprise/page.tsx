import type { Metadata } from "next";

import { ogImage } from "@/lib/og-image";

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
    "Every Classifyre feature is open source, including SSO, roles, masking and the Power BI gateway. Enterprise is a pilot, implementation, an SLA and tailoring by our engineers.",
  alternates: {
    canonical: "/open-source-vs-enterprise/",
    languages: {
      en: "/open-source-vs-enterprise/",
      de: "/de/open-source-vs-enterprise/",
      "x-default": "/open-source-vs-enterprise/",
    },
  },
  openGraph: {
    title: "Classifyre: all of it is open source. Enterprise is us, on your project.",
    description:
      "SSO, roles, masking and the SQL gateway are Apache-2.0. Enterprise is a fixed-price pilot, implementation, an SLA with named engineers and tailoring.",
    type: "website",
    images: [ogImage("en", "editions", "Classifyre: all of it is open source")],
  },
};

export default function EditionsRoute() {
  return <EditionsPage locale="en" />;
}
