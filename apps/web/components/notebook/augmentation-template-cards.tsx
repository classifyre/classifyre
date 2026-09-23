"use client";

import * as React from "react";
import { api } from "@workspace/api-client";
import { Badge, Card } from "@workspace/ui/components";
import { FileText, Loader2, Sparkles } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { appendCells, type NotebookCell } from "@/lib/notebook-cells";

/**
 * The augmentation templates as starter cards, in the source-creation style.
 *
 * Shown the first time augmentation is enabled on an empty notebook: a
 * dropdown of seven template names says nothing about which enrichment to
 * write, while one card per template shows what each one does. Picking a card
 * starts the notebook from that template; Start blank keeps the empty cells.
 * Once the notebook has cells (a template was picked, or one came back with
 * the source) this unmounts and the ordinary editor takes over — it never
 * offers to replace work already on the page.
 */
export function AugmentationTemplateCards({
  disabled = false,
  onStartBlank,
  onPick,
}: {
  disabled?: boolean;
  onStartBlank: () => void;
  onPick: (cells: NotebookCell[]) => void;
}) {
  const { t } = useTranslation();
  const [templates, setTemplates] = React.useState<
    Array<{ name: string; description: string; cells: NotebookCell[] }> | null
  >(null);
  const [failed, setFailed] = React.useState(false);

  // Loaded on mount rather than on open: these cards ARE the content, and the
  // payload is every template's full source.
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = (await api.notebooks.notebookControllerTemplates({
          scope: "augmentation",
        })) as unknown as Array<{
          name: string;
          description: string;
          cells: NotebookCell[];
        }>;
        if (!cancelled) setTemplates(result ?? []);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {t("notebook.templates.failed")}
        </p>
        <button
          type="button"
          onClick={onStartBlank}
          disabled={disabled}
          data-testid="augmentation-start-blank"
          className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
        >
          <Card clickable className="p-4">
            <div className="text-sm font-semibold">
              {t("ai.startBlank")}
            </div>
          </Card>
        </button>
      </div>
    );
  }

  if (!templates) {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="augmentation-template-cards">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <button
          type="button"
          onClick={onStartBlank}
          disabled={disabled}
          data-testid="augmentation-start-blank"
          className={cn(
            "group text-left rounded-[6px]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2",
          )}
        >
          <Card clickable className="h-full p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="inline-flex h-8 w-8 items-center justify-center rounded-[4px] border-2 border-border bg-card">
                <FileText className="h-4 w-4" />
              </div>
              <Badge className="rounded-[4px] border border-border bg-accent text-accent-foreground">
                {t("ai.start")}
              </Badge>
            </div>
            <div className="mt-3">
              <div className="text-sm font-semibold">{t("ai.startBlank")}</div>
              <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t("augmentation.startBlankDescription")}
              </div>
            </div>
          </Card>
        </button>

        {templates.map((template) => (
          <button
            key={template.name}
            type="button"
            onClick={() => onPick(appendCells([], template.cells))}
            disabled={disabled}
            data-testid={`augmentation-template-${template.name}`}
            className={cn(
              "group text-left rounded-[6px]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2",
            )}
          >
            <Card clickable className="h-full border-border bg-background p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="inline-flex h-8 w-8 items-center justify-center rounded-[4px] border-2 border-border bg-card">
                  <Sparkles className="h-4 w-4" />
                </div>
                <Badge
                  variant="outline"
                  className="rounded-[4px] border-border text-[10px]"
                >
                  {t("ai.template")}
                </Badge>
              </div>
              <div className="mt-3">
                <div className="text-sm font-semibold">{template.name}</div>
                <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {template.description ||
                    t("augmentation.templateFallbackDescription")}
                </div>
              </div>
            </Card>
          </button>
        ))}
      </div>

      {templates.length === 0 ? (
        <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
          {t("ai.noTemplatesAvailable")}
        </p>
      ) : null}
    </div>
  );
}
