import type { Metadata } from "next";

import { BlogSectionPage } from "@/components/blog-section-page";
import { getPostsBySection } from "@/lib/posts";

export const metadata: Metadata = {
  title: "Fallakten",
  description:
    "Praxisnahe Classifyre-Fallbeispiele und Feldnotizen zu echten öffentlichen Datensätzen und Governance-Szenarien.",
  alternates: {
    canonical: "/de/blog/cases/",
    languages: {
      en: "/blog/cases/",
      de: "/de/blog/cases/",
      "x-default": "/blog/cases/",
    },
  },
};

export default async function CaseFilesPageDe() {
  const posts = await getPostsBySection("cases", "de");

  return (
    <BlogSectionPage
      eyebrow="Fallakten"
      title="Echte Datensätze. Klare Beispiele."
      description="Konkrete Beispiele mit echten öffentlichen Datensätzen und Governance-Szenarien – Schritt für Schritt nachvollziehbar."
      posts={posts}
      locale="de"
    />
  );
}
