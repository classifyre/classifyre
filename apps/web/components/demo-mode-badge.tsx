"use client";

import * as React from "react";
import { ArrowRight, Eye } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { DemoUpgradeFootnote, DemoUpgradeOptions } from "./demo-upgrade-cta";
import { useTranslation } from "@/hooks/use-translation";

/**
 * Marker for the read-only demo deployment. It is a control rather than a
 * tooltip-only badge: "this is a demo" is only half the message, the other half
 * is where to get a writable instance, and a tooltip never reaches a touch
 * device.
 *
 * It appears twice, in two shapes, because the header runs out of room long
 * before the message does:
 *   - `DemoModeHeaderBadge` — an inline pill, from `md` up.
 *   - `DemoModeBanner`      — a full-width strip under the header, below `md`.
 * Only one is ever visible. Rendering both (rather than reshaping one) keeps
 * the phone version out of a header that already carries six controls and, at
 * 375px, wraps the breadcrumb as soon as anything else is added to it.
 */

const PILL_CLASSES =
  "cursor-pointer items-center gap-1.5 border-amber-600/40 bg-amber-50 text-[11px] font-semibold tracking-[0.08em] text-amber-700 uppercase transition-colors hover:bg-amber-100 focus-visible:ring-[3px] focus-visible:ring-amber-600/20 focus-visible:outline-none dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-400 dark:hover:bg-amber-950/70";

/** Shared dialog so both entry points open the same pitch. */
function DemoUpgradeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Short viewports (landscape phones) scroll rather than clip the CTAs. */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-6">{t("demo.upgradeTitle")}</DialogTitle>
          <DialogDescription>{t("demo.upgradeDescription")}</DialogDescription>
        </DialogHeader>
        <DemoUpgradeOptions />
        <DemoUpgradeFootnote />
      </DialogContent>
    </Dialog>
  );
}

export function DemoModeHeaderBadge() {
  const [open, setOpen] = React.useState(false);
  const { t } = useTranslation();

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={`hidden shrink-0 rounded-[4px] border px-2 py-1 md:flex ${PILL_CLASSES}`}
          >
            <Eye className="size-3 shrink-0" />
            {t("demo.badge")}
            <span
              aria-hidden
              className="h-3 w-px bg-amber-600/30 dark:bg-amber-500/30"
            />
            {t("demo.headerCta")}
            <ArrowRight className="size-3 shrink-0" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6} className="max-w-xs">
          {t("demo.tooltip")}
        </TooltipContent>
      </Tooltip>

      <DemoUpgradeDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

export function DemoModeBanner() {
  const [open, setOpen] = React.useState(false);
  const { t } = useTranslation();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex w-full justify-center border-b px-4 py-2 text-center md:hidden ${PILL_CLASSES}`}
      >
        <Eye className="size-3 shrink-0" />
        <span className="min-w-0">{t("demo.bannerCta")}</span>
        <ArrowRight className="size-3 shrink-0" />
      </button>

      <DemoUpgradeDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
