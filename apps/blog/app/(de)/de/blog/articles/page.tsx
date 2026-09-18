import type { Metadata } from "next";

import { BlogSectionPage } from "@/components/blog-section-page";
import { getPostsBySection } from "@/lib/posts";

export const metadata: Metadata = {
  title: "Business-Blog",
  description:
    "Ideen von Classifyre über Ermittlungsarbeit, Beweise und wie aus verstreuten Daten bessere Entscheidungen werden.",
  alternates: {
    canonical: "/de/blog/articles/",
    languages: {
      en: "/blog/articles/",
      de: "/de/blog/articles/",
      "x-default": "/blog/articles/",
    },
  },
};

export default async function BusinessBlogPageDe() {
  const posts = await getPostsBySection("articles", "de");

  return (
    <BlogSectionPage
      eyebrow="Business-Blog"
      title="Bessere Fragen. Klarere Beweise. Stärkere Entscheidungen."
      description="Ideen für Führungskräfte und Ermittlungsteams, die verstreute Organisationsdaten in Beweise verwandeln wollen, die sie verstehen und nach denen sie handeln können."
      posts={posts}
      locale="de"
    />
  );
}
