import * as React from "react";
import { X } from "lucide-react";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "./drawer";
import { Button } from "./button";
import { ScrollArea } from "./scroll-area";
import { Separator } from "./separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";
import { Textarea } from "./textarea";
import { SeverityBadge } from "./severity-badge";
import { StatusBadge } from "./status-badge";

export type FindingDrawerStatus =
  | "OPEN"
  | "FALSE_POSITIVE"
  | "RESOLVED"
  | "IGNORED";
export type FindingDrawerSeverity =
  | "CRITICAL"
  | "HIGH"
  | "MEDIUM"
  | "LOW"
  | "INFO";

export interface FindingDrawerSaveData {
  status?: FindingDrawerStatus;
  severity?: FindingDrawerSeverity;
  comment?: string;
}

export interface FindingDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finding: {
    id: string;
    status: FindingDrawerStatus;
    severity: FindingDrawerSeverity;
    confidence?: number | null;
    comment?: string | null;
    detectedAt?: Date | string | null;
    firstDetectedAt?: Date | string | null;
    lastDetectedAt?: Date | string | null;
    resolvedAt?: Date | string | null;
    runnerId?: string | null;
    /** href to the runner/scan detail page — constructed by the host app */
    runnerHref?: string | null;
  };
  onSave?: (data: FindingDrawerSaveData) => void;
  isSaving?: boolean;
}

const statusLabels: Record<FindingDrawerStatus, string> = {
  OPEN: "Open",
  FALSE_POSITIVE: "False Positive",
  RESOLVED: "Resolved",
  IGNORED: "Ignored",
};

const severityLabels: Record<FindingDrawerSeverity, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  INFO: "Info",
};

function toStatusBadgeValue(status: FindingDrawerStatus) {
  switch (status) {
    case "FALSE_POSITIVE":
      return "false_positive" as const;
    case "RESOLVED":
      return "resolved" as const;
    case "IGNORED":
      return "ignored" as const;
    default:
      return "open" as const;
  }
}

function toSeverityBadgeValue(severity: FindingDrawerSeverity) {
  switch (severity) {
    case "CRITICAL":
      return "critical" as const;
    case "HIGH":
      return "high" as const;
    case "MEDIUM":
      return "medium" as const;
    case "LOW":
      return "low" as const;
    default:
      return "info" as const;
  }
}

function toDate(value?: Date | string | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isUserUTC(): boolean {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone === "UTC";
  } catch {
    return true;
  }
}

/** Local-time display: "Feb 23, 2026, 4:28 PM" */
function formatDateTime(value?: Date | string | null): string {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Secondary UTC caption (empty when user is already in UTC). */
function formatUTCCaption(value?: Date | string | null): string {
  const d = toDate(value);
  if (!d || isUserUTC()) return "";
  return (
    d.toLocaleString("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }) + " UTC"
  );
}

/** Human-readable relative time ("3 hours ago"). */
function formatRelative(value?: Date | string | null): string {
  const d = toDate(value);
  if (!d) return "—";
  const ms = Date.now() - d.getTime();
  const abs = Math.abs(ms);
  const suffix = ms >= 0 ? " ago" : " from now";
  const mins = Math.floor(abs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min${mins !== 1 ? "s" : ""}${suffix}`;
  const hrs = Math.floor(abs / 3_600_000);
  if (hrs < 24) return `${hrs} hr${hrs !== 1 ? "s" : ""}${suffix}`;
  const days = Math.floor(abs / 86_400_000);
  return `${days} day${days !== 1 ? "s" : ""}${suffix}`;
}

function formatDuration(
  start?: Date | string | null,
  end?: Date | string | null,
): string {
  const s = toDate(start);
  if (!s) return "—";
  const e = toDate(end) ?? new Date();
  const ms = Math.abs(e.getTime() - s.getTime());
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins} min${mins !== 1 ? "s" : ""}`;
  const hrs = Math.floor(ms / 3_600_000);
  if (hrs < 24) return `${hrs} hr${hrs !== 1 ? "s" : ""}`;
  const days = Math.floor(ms / 86_400_000);
  return `${days} day${days !== 1 ? "s" : ""}`;
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="text-right text-sm font-medium text-foreground">
        {children}
      </div>
    </div>
  );
}

function DateDetailRow({
  label,
  value,
}: {
  label: string;
  value?: Date | string | null;
}) {
  const utcCaption = formatUTCCaption(value);
  return (
    <DetailRow label={label}>
      <div>
        <div>{formatDateTime(value)}</div>
        {utcCaption && (
          <div className="text-[10px] font-normal text-muted-foreground/60">
            {utcCaption}
          </div>
        )}
      </div>
    </DetailRow>
  );
}

function confidenceColor(pct: number): string {
  if (pct >= 80) return "#b7ff00";
  if (pct >= 60) return "#f59e0b";
  if (pct >= 40) return "#94a3b8";
  return "#ef4444";
}

function confidenceLabel(pct: number): string {
  if (pct >= 80) return "High";
  if (pct >= 60) return "Medium";
  if (pct >= 40) return "Low";
  return "Very Low";
}

function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const segments = 5;
  const filled = Math.round((pct / 100) * segments);
  const color = confidenceColor(pct);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex gap-[3px]">
          {Array.from({ length: segments }, (_, i) => (
            <span
              key={i}
              className="h-2.5 w-5 rounded-[2px] transition-colors"
              style={
                i < filled
                  ? {
                      backgroundColor: color,
                      border: `1.5px solid color-mix(in srgb, ${color} 80%, black 20%)`,
                    }
                  : {
                      border: "1.5px solid hsl(var(--border))",
                      backgroundColor: "transparent",
                    }
              }
            />
          ))}
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-sm font-bold" style={{ color }}>
            {pct}%
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            {confidenceLabel(pct)}
          </span>
        </div>
      </div>
    </div>
  );
}

export function FindingDetailDrawer({
  open,
  onOpenChange,
  finding,
  onSave,
  isSaving,
}: FindingDetailDrawerProps) {
  const [draftStatus, setDraftStatus] = React.useState<FindingDrawerStatus>(
    finding.status,
  );
  const [draftSeverity, setDraftSeverity] =
    React.useState<FindingDrawerSeverity>(finding.severity);
  const [draftComment, setDraftComment] = React.useState(finding.comment ?? "");

  React.useEffect(() => {
    setDraftStatus(finding.status);
    setDraftSeverity(finding.severity);
    setDraftComment(finding.comment ?? "");
  }, [finding.id, finding.status, finding.severity, finding.comment]);

  const hasChanges =
    draftStatus !== finding.status ||
    draftSeverity !== finding.severity ||
    draftComment !== (finding.comment ?? "");

  function handleSave() {
    if (!hasChanges || !onSave) return;
    const data: FindingDrawerSaveData = {};
    if (draftStatus !== finding.status) data.status = draftStatus;
    if (draftSeverity !== finding.severity) data.severity = draftSeverity;
    if (draftComment !== (finding.comment ?? "")) data.comment = draftComment;
    onSave(data);
  }

  const occurredAt = finding.firstDetectedAt ?? finding.detectedAt;
  const detectedAt = finding.lastDetectedAt ?? finding.detectedAt;
  const openedFor = formatDuration(occurredAt, finding.resolvedAt);

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      direction="right"
      modal={false}
    >
      <DrawerContent className="h-full w-full sm:max-w-[420px]" hideOverlay>
        <DrawerHeader className="border-b">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <DrawerTitle>Details</DrawerTitle>
              <DrawerDescription>
                Review and adjust finding status, severity, and notes.
              </DrawerDescription>
            </div>
            <DrawerClose asChild>
              <Button variant="ghost" size="icon" aria-label="Close details">
                <X className="h-4 w-4" />
              </Button>
            </DrawerClose>
          </div>
        </DrawerHeader>

        <ScrollArea className="flex-1">
          <div className="space-y-5 p-4">
            {/* ── Status ── */}
            <div className="space-y-2">
              <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
                Status
              </p>
              <div className="flex items-center gap-2">
                <StatusBadge status={toStatusBadgeValue(draftStatus)}>
                  {statusLabels[draftStatus]}
                </StatusBadge>
                <Select
                  value={draftStatus}
                  onValueChange={(value: string) =>
                    setDraftStatus(value as FindingDrawerStatus)
                  }
                  disabled={!onSave || isSaving}
                >
                  <SelectTrigger className="h-8 flex-1 border-2 border-border rounded-[4px] text-xs font-mono">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.keys(statusLabels).map((status) => (
                      <SelectItem key={status} value={status}>
                        {statusLabels[status as FindingDrawerStatus]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* ── Severity ── */}
            <div className="space-y-2">
              <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
                Severity
              </p>
              <div className="flex items-center gap-2">
                <SeverityBadge severity={toSeverityBadgeValue(draftSeverity)}>
                  {severityLabels[draftSeverity]}
                </SeverityBadge>
                <Select
                  value={draftSeverity}
                  onValueChange={(value: string) =>
                    setDraftSeverity(value as FindingDrawerSeverity)
                  }
                  disabled={!onSave || isSaving}
                >
                  <SelectTrigger className="h-8 flex-1 border-2 border-border rounded-[4px] text-xs font-mono">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.keys(severityLabels).map((severity) => (
                      <SelectItem key={severity} value={severity}>
                        {severityLabels[severity as FindingDrawerSeverity]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* ── Comment ── */}
            <div className="space-y-2">
              <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
                Comment
              </p>
              <Textarea
                value={draftComment}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setDraftComment(e.target.value)
                }
                placeholder="Add a note to this finding…"
                disabled={!onSave || isSaving}
                className="min-h-[80px] resize-none border-2 border-border rounded-[4px] text-sm"
                rows={3}
              />
            </div>

            {/* ── Save button ── */}
            {hasChanges && onSave && (
              <Button
                onClick={handleSave}
                disabled={isSaving}
                className="w-full border-2 border-[#b7ff00]/30 bg-[#0b0f0a] text-[#b7ff00] hover:bg-[#0b0f0a]/80 rounded-[4px] font-mono text-xs uppercase tracking-[0.1em]"
              >
                {isSaving ? "Saving…" : "Save changes"}
              </Button>
            )}

            <Separator />

            {/* ── Confidence ── */}
            {finding.confidence != null && (
              <>
                <div className="space-y-2">
                  <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
                    Confidence
                  </p>
                  <ConfidenceMeter value={finding.confidence} />
                </div>
                <Separator />
              </>
            )}

            {/* ── Dates ── */}
            <div className="space-y-3">
              <DateDetailRow label="First detected" value={occurredAt} />
              <DateDetailRow label="Last detected" value={detectedAt} />
              <DetailRow label="Open for">
                <span className="font-mono text-xs">{openedFor}</span>
              </DetailRow>
              {finding.resolvedAt && (
                <DateDetailRow label="Resolved" value={finding.resolvedAt} />
              )}
            </div>

            <Separator />

            {/* ── Set by (runner link) ── */}
            <DetailRow label="Set by">
              {finding.runnerHref ? (
                <a
                  href={finding.runnerHref}
                  className="font-mono text-xs text-muted-foreground underline-offset-4 hover:underline hover:text-foreground transition-colors"
                >
                  {formatRelative(detectedAt)}
                </a>
              ) : (
                <span className="font-mono text-xs text-muted-foreground">
                  Manual
                </span>
              )}
            </DetailRow>
          </div>
        </ScrollArea>
      </DrawerContent>
    </Drawer>
  );
}
