import type { Metadata } from "next";

import { EditionsPage } from "@/components/editions";

import "../../../landing.css";

/**
 * /de/open-source-vs-enterprise (German). Same shared `<EditionsPage>` as
 * the English route, only metadata and words differ.
 */

export const metadata: Metadata = {
  title: "Open Source vs. Enterprise: Gleiche Engine, anderer Raum",
  description:
    "Ein schlichter Vergleich von Classifyres Open-Source-Kern und dem Enterprise-Layer. Jede Detektions-, Ermittlungs- und Deployment-Funktion ist Open Source; Enterprise legt SSO, Rollen, Autorisierung pro Workspace, abgestimmte Modelle und Support mit SLA drauf.",
  alternates: {
    canonical: "/de/open-source-vs-enterprise/",
    languages: {
      en: "/open-source-vs-enterprise/",
      de: "/de/open-source-vs-enterprise/",
      "x-default": "/open-source-vs-enterprise/",
    },
  },
  openGraph: {
    title: "Classifyre: Open Source vs. Enterprise",
    description:
      "Detektion, Ermittlungen, Autopilot und beide Runtimes sind Open Source. Enterprise legt die Governance-Schicht und unsere Engineers drauf.",
    type: "website",
  },
};

export default function GermanEditionsRoute() {
  return <EditionsPage locale="de" />;
}
