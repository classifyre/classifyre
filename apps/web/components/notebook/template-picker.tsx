"use client";

import * as React from "react";
import { api } from "@workspace/api-client";
import { BookOpen, Loader2 } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { useTranslation } from "@/hooks/use-translation";
import type { NotebookCell } from "@/lib/notebook-cells";

interface NotebookTemplate {
  name: string;
  description: string;
  cells: NotebookCell[];
}

/**
 * Worked notebooks an author can borrow cells from.
 *
 * Fetched rather than bundled, and appended rather than replacing: the examples
 * live next to every other source's in `all_input_examples.json`, so a template
 * that teaches `ctx.files` or `parse()` cannot drift from the SDK it teaches,
 * and picking one never costs the author what they have already written.
 */
export function TemplatePicker({
  onInsert,
  disabled = false,
}: {
  onInsert: (cells: NotebookCell[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [templates, setTemplates] = React.useState<NotebookTemplate[] | null>(
    null,
  );
  const [loading, setLoading] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  // Loaded when the menu is first opened: most sessions never open it, and the
  // payload is every template's full source.
  const load = React.useCallback(async () => {
    if (templates || loading) return;
    setLoading(true);
    try {
      const result = (await api.notebooks.notebookControllerTemplates()) as
        | NotebookTemplate[]
        | undefined;
      setTemplates(result ?? []);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [templates, loading]);

  return (
    <DropdownMenu onOpenChange={(open) => open && void load()}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          data-testid="notebook-templates"
        >
          <BookOpen className="mr-1.5 h-3.5 w-3.5" />
          {t("notebook.templates.button")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-96">
        <DropdownMenuLabel className="font-normal text-xs text-muted-foreground">
          {t("notebook.templates.hint")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {loading && (
          <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("common.loading")}
          </div>
        )}
        {!loading && failed && (
          <div className="px-2 py-3 text-sm text-muted-foreground">
            {t("notebook.templates.failed")}
          </div>
        )}
        {!loading &&
          !failed &&
          templates?.map((template) => (
            <DropdownMenuItem
              key={template.name}
              className="flex-col items-start gap-0.5 whitespace-normal"
              onSelect={() => onInsert(template.cells)}
              data-testid={`notebook-template-${template.name}`}
            >
              <span className="text-sm font-medium">{template.name}</span>
              <span className="text-xs text-muted-foreground">
                {template.description}
              </span>
            </DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
