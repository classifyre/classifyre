"use client";

import * as React from "react";
import DOMPurify, { type Config as SanitizeConfig } from "dompurify";
import { AlertTriangle } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";

/**
 * Rendering results produced by code the user wrote.
 *
 * Every branch here treats notebook output as untrusted. It is authored by
 * whoever can edit the notebook, but it is *read* by anyone who can open the
 * source -- so HTML and SVG are sanitized rather than trusted, and no branch
 * evaluates script the notebook returned.
 *
 * Renderers are chosen richest-first, and anything unrecognized falls through
 * to text/plain, so a MIME type we have never seen shows its content instead of
 * an empty box.
 */

export interface StreamOutput {
  type: "stream";
  name: "stdout" | "stderr";
  text: string;
}

export interface DisplayOutput {
  type: "display";
  data: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export interface ErrorOutput {
  type: "error";
  ename: string;
  evalue: string;
  traceback: string[];
}

export type CellOutputValue = StreamOutput | DisplayOutput | ErrorOutput;

/**
 * A deliberately narrow allowlist: enough for a DataFrame's `_repr_html_`, and
 * nothing that can navigate, load a subresource, or run.
 */
const HTML_SANITIZE_CONFIG: SanitizeConfig = {
  ALLOWED_TAGS: [
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "th",
    "td",
    "caption",
    "colgroup",
    "col",
    "div",
    "span",
    "p",
    "pre",
    "code",
    "br",
    "hr",
    "ul",
    "ol",
    "li",
    "dl",
    "dt",
    "dd",
    "b",
    "i",
    "em",
    "strong",
    "small",
    "sub",
    "sup",
    "u",
    "s",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "style",
  ],
  ALLOWED_ATTR: [
    "class",
    "colspan",
    "rowspan",
    "align",
    "scope",
    "style",
    "title",
  ],
  // No <a href>, no <img src>: a notebook output has no reason to make the
  // reader's browser fetch or navigate anywhere.
  FORBID_TAGS: [
    "script",
    "iframe",
    "object",
    "embed",
    "form",
    "input",
    "a",
    "img",
    "link",
    "base",
  ],
  FORBID_ATTR: ["href", "src", "srcset", "formaction", "xlink:href"],
  ALLOW_DATA_ATTR: false,
};

const SVG_SANITIZE_CONFIG: SanitizeConfig = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ["script", "foreignObject", "a", "image", "use"],
  FORBID_ATTR: ["href", "xlink:href", "onload"],
  ALLOW_DATA_ATTR: false,
};

function sanitize(markup: string, config: SanitizeConfig): string {
  return DOMPurify.sanitize(markup, config) as unknown as string;
}

function ScrollBox({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  // Wide output (a 40-column DataFrame) must scroll inside its own box rather
  // than stretching the page.
  return (
    <div
      className={cn(
        "max-h-96 overflow-auto rounded-md border bg-muted/20",
        className,
      )}
    >
      {children}
    </div>
  );
}

function StreamView({ output }: { output: StreamOutput }) {
  return (
    <ScrollBox
      className={cn(output.name === "stderr" && "border-destructive/40")}
    >
      <pre
        className={cn(
          "whitespace-pre-wrap break-words p-3 font-mono text-xs",
          output.name === "stderr" && "text-destructive",
        )}
        data-testid={`output-stream-${output.name}`}
      >
        {output.text}
      </pre>
    </ScrollBox>
  );
}

function PngView({ value }: { value: string }) {
  return (
    <div className="rounded-md border bg-background p-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`data:image/png;base64,${value}`}
        alt=""
        className="max-w-full"
        data-testid="output-png"
      />
    </div>
  );
}

function SvgView({ value }: { value: string }) {
  const clean = React.useMemo(
    () => sanitize(value, SVG_SANITIZE_CONFIG),
    [value],
  );
  return (
    <div className="overflow-auto rounded-md border bg-background p-2">
      <div
        className="[&_svg]:max-w-full"
        data-testid="output-svg"
        dangerouslySetInnerHTML={{ __html: clean }}
      />
    </div>
  );
}

function HtmlView({ value }: { value: string }) {
  const clean = React.useMemo(
    () => sanitize(value, HTML_SANITIZE_CONFIG),
    [value],
  );
  return (
    <ScrollBox>
      <div
        className={cn(
          "p-3 text-xs",
          "[&_table]:w-full [&_table]:border-collapse",
          "[&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium",
          "[&_td]:border [&_td]:px-2 [&_td]:py-1",
        )}
        data-testid="output-html"
        dangerouslySetInnerHTML={{ __html: clean }}
      />
    </ScrollBox>
  );
}

function JsonView({ value }: { value: string }) {
  const formatted = React.useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }, [value]);
  return (
    <ScrollBox>
      <pre className="p-3 font-mono text-xs" data-testid="output-json">
        {formatted}
      </pre>
    </ScrollBox>
  );
}

function PlainView({ value }: { value: string }) {
  return (
    <ScrollBox>
      <pre
        className="whitespace-pre-wrap break-words p-3 font-mono text-xs"
        data-testid="output-plain"
      >
        {value}
      </pre>
    </ScrollBox>
  );
}

function DisplayView({ output }: { output: DisplayOutput }) {
  const data = output.data ?? {};
  if (data["image/png"]) return <PngView value={data["image/png"]} />;
  if (data["image/svg+xml"]) return <SvgView value={data["image/svg+xml"]} />;
  if (data["text/html"]) return <HtmlView value={data["text/html"]} />;
  if (data["application/json"])
    return <JsonView value={data["application/json"]} />;
  return <PlainView value={data["text/plain"] ?? ""} />;
}

export function ErrorView({
  error,
  cellId,
}: {
  error: {
    type?: string;
    message?: string;
    traceback?: string[];
    cellId?: string | null;
  };
  cellId?: string;
}) {
  const { t } = useTranslation();
  // The cell that raised is often not the cell the user clicked Run on.
  const elsewhere = error.cellId && cellId && error.cellId !== cellId;

  return (
    <div
      className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3"
      data-testid="output-error"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-destructive">
            {error.type}: {error.message}
          </p>
          {elsewhere && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("notebook.errorInOtherCell", { cell: error.cellId! })}
            </p>
          )}
        </div>
      </div>
      {error.traceback && error.traceback.length > 0 && (
        <ScrollBox className="border-destructive/30 bg-transparent">
          <pre className="whitespace-pre-wrap break-words p-3 font-mono text-[11px] text-destructive/90">
            {error.traceback.join("")}
          </pre>
        </ScrollBox>
      )}
    </div>
  );
}

export function CellOutput({ output }: { output: CellOutputValue }) {
  if (output.type === "stream") return <StreamView output={output} />;
  if (output.type === "error") {
    return (
      <ErrorView
        error={{
          type: output.ename,
          message: output.evalue,
          traceback: output.traceback,
        }}
      />
    );
  }
  return <DisplayView output={output} />;
}

export function CellOutputs({ outputs }: { outputs: CellOutputValue[] }) {
  if (!outputs?.length) return null;
  return (
    <div className="space-y-2" data-testid="cell-outputs">
      {outputs.map((output, index) => (
        <CellOutput key={index} output={output} />
      ))}
    </div>
  );
}
