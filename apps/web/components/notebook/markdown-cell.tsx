"use client";

import * as React from "react";
import DOMPurify from "dompurify";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { CellToolbar } from "./cell-toolbar";

export interface MarkdownCellProps {
  cellId: string;
  /** Position in the notebook, shown so ordering is legible while reordering. */
  index?: number;
  source: string;
  disabled?: boolean;
  deletable?: boolean;
  undeletableReason?: string;
  onChange: (source: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onAddCodeBelow?: () => void;
  onAddMarkdownBelow?: () => void;
  onSave: () => void;
  /** Extra toolbar controls, rendered at the bottom of the strip. */
  toolbarFooter?: React.ReactNode;
}

/**
 * A small Markdown subset, rendered without a parser dependency.
 *
 * Notebook prose is headings, emphasis, code spans and lists; pulling in a full
 * CommonMark implementation for that would be more surface than the feature
 * needs. Everything is HTML-escaped first and sanitized after, so the narrow
 * renderer is not what stands between a document and an injection.
 */
function renderMarkdown(source: string): string {
  const escaped = source
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const lines = escaped.split("\n");
  const html: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let inFence = false;
  let fence: string[] = [];

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };

  const inline = (text: string) =>
    text
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inFence) {
        html.push(`<pre><code>${fence.join("\n")}</code></pre>`);
        fence = [];
        inFence = false;
      } else {
        closeList();
        inFence = true;
      }
      continue;
    }
    if (inFence) {
      fence.push(line);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1]!.length;
      html.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      if (listType !== "ul") {
        closeList();
        html.push("<ul>");
        listType = "ul";
      }
      html.push(`<li>${inline(bullet[1]!)}</li>`);
      continue;
    }

    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      if (listType !== "ol") {
        closeList();
        html.push("<ol>");
        listType = "ol";
      }
      html.push(`<li>${inline(numbered[1]!)}</li>`);
      continue;
    }

    if (!line.trim()) {
      closeList();
      continue;
    }

    closeList();
    html.push(`<p>${inline(line)}</p>`);
  }

  if (inFence && fence.length) {
    html.push(`<pre><code>${fence.join("\n")}</code></pre>`);
  }
  closeList();

  return DOMPurify.sanitize(html.join("\n"), {
    ALLOWED_TAGS: [
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "ul",
      "ol",
      "li",
      "code",
      "pre",
      "strong",
      "em",
      "br",
    ],
    ALLOWED_ATTR: [],
  }) as unknown as string;
}

export function MarkdownCell({
  cellId,
  index,
  source,
  disabled = false,
  deletable = true,
  undeletableReason,
  onChange,
  onDelete,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onAddCodeBelow,
  onAddMarkdownBelow,
  onSave,
  toolbarFooter,
}: MarkdownCellProps) {
  const { t } = useTranslation();
  // A new, empty cell opens in edit mode -- nobody adds a markdown cell in
  // order to look at nothing.
  const [editing, setEditing] = React.useState(!source.trim());
  const rendered = React.useMemo(() => renderMarkdown(source), [source]);

  return (
    <div
      className="rounded-md border bg-muted/20 transition-colors"
      data-testid={`cell-${cellId}`}
    >
      <div className="flex items-start gap-2 p-2">
        {index != null && (
          // Prose is not executed, so this is a position, not a run counter --
          // but without it a markdown cell has no visible place in the order.
          <span className="shrink-0 pt-2 font-mono text-[10px] text-muted-foreground">
            [{index + 1}]
          </span>
        )}
        <div className="min-w-0 flex-1">
          {editing ? (
            <Textarea
              value={source}
              onChange={(event) => onChange(event.target.value)}
              onBlur={() => setEditing(false)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "s") {
                  event.preventDefault();
                  onSave();
                }
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  setEditing(false);
                }
              }}
              autoFocus
              disabled={disabled}
              className="min-h-24 resize-y border-0 bg-background font-mono text-sm"
              data-testid={`markdown-editor-${cellId}`}
            />
          ) : (
            <button
              type="button"
              onClick={() => !disabled && setEditing(true)}
              className={cn(
                "w-full cursor-text rounded px-2 py-1 text-left text-sm",
                "[&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold",
                "[&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold",
                "[&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold",
                "[&_p]:mb-2 [&_p]:leading-relaxed",
                "[&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5",
                "[&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5",
                "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs",
                "[&_pre]:mb-2 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2",
              )}
              data-testid={`markdown-preview-${cellId}`}
            >
              {source.trim() ? (
                <div dangerouslySetInnerHTML={{ __html: rendered }} />
              ) : (
                <span className="text-muted-foreground">
                  {t("notebook.emptyMarkdown")}
                </span>
              )}
            </button>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setEditing((value) => !value)}
            disabled={disabled}
            aria-label={
              editing
                ? t("notebook.markdownPreview")
                : t("notebook.markdownEdit")
            }
            data-testid={`toggle-markdown-${cellId}`}
          >
            {editing ? (
              <Eye className="h-3.5 w-3.5" />
            ) : (
              <Pencil className="h-3.5 w-3.5" />
            )}
          </Button>
          <CellToolbar
            cellId={cellId}
            disabled={disabled}
            deletable={deletable}
            undeletableReason={undeletableReason}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
            onAddCodeBelow={onAddCodeBelow}
            onAddMarkdownBelow={onAddMarkdownBelow}
          />
        </div>
      </div>
    </div>
  );
}

export { renderMarkdown };
