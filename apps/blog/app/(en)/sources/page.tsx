import type { Metadata } from "next";

import { SourcesPage } from "@/components/sources";
import { sourceCount } from "@/components/source-showcase";
import { routes } from "@/lib/site";

import "../../landing.css";

const total = sourceCount();

export const metadata: Metadata = {
  title: "Supported Sources",
  description: `Every system Classifyre can scan: ${total} connectors across databases, warehouses and lakehouses, streaming, object storage, collaboration tools, analytics, and public content. Each connector links to its configuration reference.`,
  alternates: { canonical: routes.sources },
  openGraph: {
    title: "Classifyre: Supported Sources",
    description: `${total} connectors across databases, lakehouses, storage, collaboration tools, analytics, and public content.`,
    type: "website",
  },
};

export default function SourcesPageEn() {
  return <SourcesPage locale="en" />;
}
