"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Bot,
  CalendarClock,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { api, type CaseEventDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Badge } from "@workspace/ui/components/badge";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Textarea } from "@workspace/ui/components/textarea";
import { Slider } from "@workspace/ui/components/slider";
import { EmptyState } from "@workspace/ui/components/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog";

const PRECISIONS = ["DAY", "MONTH", "YEAR"] as const;
type Precision = (typeof PRECISIONS)[number];

// ─── Date helpers ─────────────────────────────────────────────────────────────

/** yyyy-mm-dd from UTC components, for the native date input. */
function toDateInputValue(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Display date, formatted per the event's precision. Uses UTC components so
 *  the calendar date shown doesn't shift with the viewer's timezone. */
function formatEventDate(occurredAt: Date | string, precision: string): string {
  const d = occurredAt instanceof Date ? occurredAt : new Date(occurredAt);
  if (precision === "YEAR") return String(d.getUTCFullYear());
  if (precision === "MONTH") {
    return d.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

// ─── Add/edit dialog ────────────────────────────────────────────────────────

interface EventFormState {
  date: string;
  precision: Precision;
  title: string;
  description: string;
  confidence: number;
}

function emptyForm(): EventFormState {
  return {
    date: toDateInputValue(new Date()),
    precision: "DAY",
    title: "",
    description: "",
    confidence: 100,
  };
}

function formFromEvent(event: CaseEventDto): EventFormState {
  return {
    date: toDateInputValue(new Date(event.occurredAt)),
    precision: (event.precision as Precision) ?? "DAY",
    title: event.title,
    description: event.description ?? "",
    confidence:
      event.confidence != null ? Math.round(event.confidence * 100) : 100,
  };
}

function EventDialog({
  caseId,
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  caseId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: CaseEventDto | null;
  onSaved: () => void;
}) {
  const [form, setForm] = React.useState<EventFormState>(emptyForm());
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) setForm(editing ? formFromEvent(editing) : emptyForm());
  }, [open, editing]);

  const submit = async () => {
    if (!form.title.trim() || !form.date) return;
    setSaving(true);
    try {
      const occurredAt = new Date(`${form.date}T00:00:00.000Z`);
      const payload = {
        occurredAt,
        precision: form.precision as never,
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        confidence: form.confidence / 100,
      };
      if (editing) {
        // PATCH implicitly verifies the event, per the API contract.
        await api.cases.caseEventsControllerUpdate({
          caseId,
          eventId: editing.id,
          updateCaseEventDto: payload,
        });
        toast.success("Event updated");
      } else {
        await api.cases.caseEventsControllerCreate({
          caseId,
          createCaseEventDto: payload,
        });
        toast.success("Event added");
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      console.error(err);
      toast.error(editing ? "Failed to update event" : "Failed to add event");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit event" : "Add event"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Saving marks this event as verified."
              : "Record a dated real-world event for the case chronology."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="flex gap-3">
            <div className="flex-1 space-y-1.5">
              <Label>Date</Label>
              <Input
                type="date"
                value={form.date}
                onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
              />
            </div>
            <div className="w-32 space-y-1.5">
              <Label>Precision</Label>
              <Select
                value={form.precision}
                onValueChange={(v) => setForm((p) => ({ ...p, precision: v as Precision }))}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRECISIONS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p.charAt(0) + p.slice(1).toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              placeholder="What happened…"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              rows={3}
              placeholder="Optional detail…"
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              Confidence: <span className="text-foreground">{form.confidence}%</span>
            </Label>
            <Slider
              value={[form.confidence]}
              min={0}
              max={100}
              step={5}
              onValueChange={([v]) => setForm((p) => ({ ...p, confidence: v ?? 0 }))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !form.title.trim() || !form.date}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {editing ? "Save" : "Add event"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Chronology ─────────────────────────────────────────────────────────────

export function CaseChronology({
  caseId,
  events,
  loading,
  onChanged,
}: {
  caseId: string;
  events: CaseEventDto[];
  loading: boolean;
  onChanged: () => void;
}) {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<CaseEventDto | null>(null);
  const [verifyingId, setVerifyingId] = React.useState<string | null>(null);

  const sorted = React.useMemo(
    () =>
      [...events].sort(
        (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
      ),
    [events],
  );

  const openAdd = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (event: CaseEventDto) => {
    setEditing(event);
    setDialogOpen(true);
  };

  const verify = async (event: CaseEventDto) => {
    setVerifyingId(event.id);
    try {
      await api.cases.caseEventsControllerUpdate({
        caseId,
        eventId: event.id,
        updateCaseEventDto: { verified: true },
      });
      toast.success("Event verified");
      onChanged();
    } catch (err) {
      console.error(err);
      toast.error("Failed to verify event");
    } finally {
      setVerifyingId(null);
    }
  };

  const remove = async (event: CaseEventDto) => {
    try {
      await api.cases.caseEventsControllerRemove({ caseId, eventId: event.id });
      toast.success("Event removed");
      onChanged();
    } catch (err) {
      console.error(err);
      toast.error("Failed to remove event");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground max-w-2xl text-xs">
          A dated timeline of real-world events behind this case — distinct from the
          system activity log.
        </p>
        <Button size="sm" onClick={openAdd}>
          <Plus className="h-3.5 w-3.5" /> Add event
        </Button>
      </div>

      {loading && sorted.length === 0 ? (
        <div className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading chronology…
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No events yet"
          description="Record the dated real-world events behind this case — when things happened, not just when they were noticed. The AI autopilot may also propose events for you to verify."
          action={{ label: "Add event", onClick: openAdd }}
        />
      ) : (
        <ol className="ml-2 border-l-2 border-border">
          {sorted.map((event) => {
            const unverifiedAgent = event.origin === "AGENT" && !event.verified;
            return (
              <li key={event.id} className="relative py-3 pl-6">
                <span className="absolute -left-[9px] top-3 flex h-4 w-4 items-center justify-center rounded-full border-2 border-border bg-card text-muted-foreground">
                  <CalendarClock className="h-2.5 w-2.5" />
                </span>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                        {formatEventDate(event.occurredAt, event.precision)}
                      </span>
                      {unverifiedAgent && (
                        <Badge
                          variant="outline"
                          className="gap-1 rounded-[4px] border-amber-500/30 bg-amber-50 text-[10px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                        >
                          <Bot className="h-3 w-3" /> Unverified · agent
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm font-medium">{event.title}</p>
                    {event.description && (
                      <p className="text-muted-foreground mt-0.5 whitespace-pre-wrap text-xs">
                        {event.description}
                      </p>
                    )}
                    <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
                      {event.confidence != null && (
                        <span>{Math.round(event.confidence * 100)}% confidence</span>
                      )}
                      {event.findingIds.length > 0 && (
                        <span>
                          {event.findingIds.length} linked finding
                          {event.findingIds.length === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {unverifiedAgent && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void verify(event)}
                        disabled={verifyingId === event.id}
                      >
                        {verifyingId === event.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ShieldCheck className="h-3.5 w-3.5" />
                        )}
                        Verify
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      aria-label="Edit event"
                      onClick={() => openEdit(event)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive h-7 w-7"
                          aria-label="Delete event"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete this event?</AlertDialogTitle>
                          <AlertDialogDescription>
                            The chronology entry is removed. Linked findings and evidence
                            stay in the case.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => void remove(event)}>
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <EventDialog
        caseId={caseId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={onChanged}
      />
    </div>
  );
}
