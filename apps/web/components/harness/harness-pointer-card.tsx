"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Bot } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";

/**
 * The Investigation Autopilot settings moved to their own Harness AI workspace.
 * This card points operators there from the old Settings location.
 */
export function HarnessPointerCard() {
  const { t } = useTranslation();
  return (
    <Card className="panel-card rounded-[6px]">
      <CardHeader className="gap-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-[#d97706]" />
            <p className="font-mono text-xs uppercase tracking-[0.14em]">
              {t("harness.subtitle")}
            </p>
          </div>
          <CardTitle>{t("harness.pointer.title")}</CardTitle>
          <CardDescription>{t("harness.pointer.desc")}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link href="/harness">
            {t("harness.pointer.cta")}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
