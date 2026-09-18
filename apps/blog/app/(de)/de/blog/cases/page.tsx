import type { Metadata } from "next";

import { BlogSectionPage } from "@/components/blog-section-page";
import { getPostsBySection } from "@/lib/posts";

export const metadata: Metadata = {
  title: "Ermittlungs-Fallakten",
  description:
    "Beweisgeführte Classifyre-Feldnotizen aus Ermittlungen in echten öffentlichen Datensätzen.",
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
      title="Ermittlungen, die Sie prüfen können."
      description="Feldnotizen aus echten öffentlichen Datensätzen: was Classifyre gefunden hat, welche Fragen es eröffnet hat und wo menschliches Urteil weiterhin zählt."
      posts={posts}
      locale="de"
    />
  );
}
