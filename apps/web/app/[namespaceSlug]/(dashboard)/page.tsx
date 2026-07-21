import type { Metadata } from "next";
import { redirect } from "next/navigation";
import enTranslations from "@/i18n/en";
import { translate } from "@/i18n";

export const metadata: Metadata = {
  title: translate(enTranslations, "discovery.title"),
};

export default async function HomePage({
  params,
}: {
  params: Promise<{ namespaceSlug: string }>;
}) {
  const { namespaceSlug } = await params;
  redirect(`/${namespaceSlug}/discovery`);
}
