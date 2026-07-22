"use client";

import Image from "next/image";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { useTranslation } from "@/hooks/use-translation";

export function WorkspaceHeader() {
  const { t } = useTranslation();

  return (
    <header className="border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <Image
            src="/clasifyre_icon.png"
            width={36}
            height={36}
            alt=""
            className="size-9 shrink-0 rounded-sm object-cover"
          />
          <div className="min-w-0 leading-tight">
            <div className="truncate font-serif text-sm font-bold uppercase tracking-[0.08em]">
              {t("app.name")}
            </div>
            <div className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {t("workspaces.directory")}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
