import type { Metadata } from "next";

import { BlogSectionPage } from "@/components/blog-section-page";
import { getPostsBySection } from "@/lib/posts";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Praxisnahe Artikel von Classifyre zu Zugriffssteuerung, Datenmaskierung, Datenqualität und selbst betriebenem Self-Service.",
  alternates: {
    canonical: "/de/blog/articles/",
    languages: {
      en: "/blog/articles/",
      de: "/de/blog/articles/",
      "x-default": "/blog/articles/",
    },
  },
};

export default async function BlogArticlesPageDe() {
  const posts = await getPostsBySection("articles", "de");

  return (
    <BlogSectionPage
      eyebrow="Blog"
      title="Klare Regeln. Maskierte Daten. Sicherer Zugriff."
      description="Praxisnahe Artikel für Daten-, IT- und Sicherheitsteams: Zugriff nach Rollen steuern, sensible Daten maskieren und geprüfte Datensätze sicher teilen."
      posts={posts}
      locale="de"
    />
  );
}
