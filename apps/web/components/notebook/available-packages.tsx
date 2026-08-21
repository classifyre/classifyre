"use client";

import * as React from "react";
import { ChevronDown, Library } from "lucide-react";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import {
  RUNTIME_PACKAGES,
  filterRuntimePackages,
} from "@/lib/notebook-runtime-packages";

/**
 * What the runtime already has, read-only.
 *
 * Shown next to the editable package table because the two answer the same
 * question and the wrong answer is expensive: before this, an author had no way
 * to know that `requests` and `pdfplumber` were already installed, so they
 * declared them again -- paying an install on every run, at a version that
 * differed from the one the lock had resolved.
 *
 * Collapsed by default: this is a reference, not a decision.
 */
export function AvailablePackages() {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const matches = React.useMemo(() => filterRuntimePackages(query), [query]);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-md border bg-muted/20"
      data-testid="notebook-available-packages"
    >
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full justify-between px-3 py-2 hover:bg-muted/40"
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            <Library className="h-3.5 w-3.5 text-muted-foreground" />
            {t("notebook.packages.available.title", {
              count: RUNTIME_PACKAGES.length,
            })}
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-3 border-t px-3 py-3">
        <p className="text-xs text-muted-foreground">
          {t("notebook.packages.available.description")}
        </p>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("notebook.packages.available.filter")}
          autoComplete="off"
          spellCheck={false}
          className="h-8 text-sm"
          data-testid="available-packages-filter"
        />
        {matches.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            {t("notebook.packages.available.noMatches")}
          </p>
        ) : (
          <ul className="max-h-72 divide-y overflow-auto rounded-md border bg-background">
            {matches.map((entry) => (
              <li
                key={entry.name}
                className="flex items-center justify-between gap-3 px-3 py-1.5"
              >
                <span className="min-w-0 truncate font-mono text-xs">
                  {entry.name}
                  {/* Only when it differs, so the common case stays quiet. */}
                  {entry.modules[0] !== entry.name.replace(/-/g, "_") && (
                    <span className="ml-2 text-muted-foreground">
                      import {entry.modules.join(", ")}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    {entry.version}
                  </span>
                  <Badge
                    variant={
                      entry.availability === "always" ? "secondary" : "outline"
                    }
                    className="text-[10px] font-normal"
                  >
                    {entry.availability === "always"
                      ? t("notebook.packages.available.installed")
                      : t("notebook.packages.available.onDemand")}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
