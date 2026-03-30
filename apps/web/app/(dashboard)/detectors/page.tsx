"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { CustomDetectorsTable } from "@/components/custom-detectors-table";
import { useTranslation } from "@/hooks/use-translation";

export default function CustomDetectorsPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
            {t("detectors.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("detectors.description")}
          </p>
        </div>
        <Button asChild className="rounded-[4px] border-2 border-black">
          <Link href="/detectors/new">
            <Plus className="mr-2 h-4 w-4" />
            {t("detectors.newDetector")}
          </Link>
        </Button>
      </div>

      <CustomDetectorsTable />
    </div>
  );
}
