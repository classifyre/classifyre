import type { Metadata } from "next";

import { GetPage } from "@/components/get";
import { routes } from "@/lib/site";

import "../../landing.css";

export const metadata: Metadata = {
  title: "Get Classifyre",
  description:
    "Run Classifyre free: one Docker image with the database, the UI and the scan workers inside, or the Helm chart on Kubernetes. Requirements, the run command, first-run steps, and upgrade guidance.",
  alternates: { canonical: routes.get },
  openGraph: {
    title: "Get Classifyre",
    description:
      "One docker run on macOS, Windows or Linux, or a Helm chart on Kubernetes. Free and open source, no signup, no sales call.",
    type: "website",
  },
};

export default function GetPageEn() {
  return <GetPage locale="en" />;
}
