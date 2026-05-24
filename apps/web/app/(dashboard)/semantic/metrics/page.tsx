import type { Metadata } from "next";
import { redirect } from "next/navigation";
import enTranslations from "@/i18n/en";
import { translate } from "@/i18n";

export const metadata: Metadata = {
  title: translate(enTranslations, "semantic.title"),
};

export default function MetricsListPage() {
  redirect("/semantic");
}
