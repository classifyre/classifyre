import type { Metadata } from "next";

import { GetPage } from "@/components/get";

import "../../../landing.css";

export const metadata: Metadata = {
  title: "Classifyre holen",
  description:
    "Classifyre kostenlos betreiben: ein Docker-Image mit Datenbank, UI und Scan-Workern darin, oder der Helm-Chart auf Kubernetes. Voraussetzungen, Run-Befehl, erste Schritte und Upgrade-Hinweise.",
  alternates: {
    canonical: "/de/get/",
    languages: {
      en: "/get/",
      de: "/de/get/",
      "x-default": "/get/",
    },
  },
  openGraph: {
    title: "Classifyre holen",
    description:
      "Ein docker run auf macOS, Windows oder Linux, oder ein Helm-Chart auf Kubernetes. Kostenlos und Open Source, keine Anmeldung, kein Sales-Anruf.",
    type: "website",
  },
};

export default function GetPageDe() {
  return <GetPage locale="de" />;
}
