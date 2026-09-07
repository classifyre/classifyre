"use client";

import * as React from "react";
import { Bot, PauseCircle, Play, PlayCircle } from "lucide-react";
import { api, type SupervisorStateDto } from "@workspace/api-client";
import {
  Button,
  Input,
  Label,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@workspace/ui/components";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/use-translation";
import { formatRelative } from "@/lib/date";
import { HarnessStatTile } from "../harness-stat-tile";
import { SupervisorGoals } from "./supervisor-goals";
import { SupervisorJournal } from "./supervisor-journal";
import { SupervisorCapabilities } from "./supervisor-capabilities";
import { SupervisorUndo } from "./supervisor-undo";

const POLL_MS = 15000;

type Inner = "goals" | "journal" | "capabilities" | "undo" | "settings";

/**
 * The supervisor's control surface.
 *
 * Ordered by what an operator actually wants to know, in order: is it on, when
 * does it next run, what has it cost — then what it is trying to do, what it
 * did, and what it is allowed to do.
 */
export function SupervisorPanel() {
  const { t } = useTranslation();
  const [state, setState] = React.useState<SupervisorStateDto | null>(null);
  const [view, setView] = React.useState<Inner>("goals");
  const [instruction, setInstruction] = React.useState("");
  const [waking, setWaking] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setState(await api.autopilot.supervisorControllerState());
    } catch {
      /* transient */
    }
  }, []);

  React.useEffect(() => {
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const patch = async (body: Parameters<
    typeof api.autopilot.supervisorControllerUpdate
  >[0]["updateSupervisorDto"]) => {
    try {
      setState(
        await api.autopilot.supervisorControllerUpdate({
          updateSupervisorDto: body,
        }),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("settings.failedToSave"));
    }
  };

  const wake = async () => {
    setWaking(true);
    try {
      await api.autopilot.supervisorControllerWake({
        wakeSupervisorDto: { instruction: instruction.trim() || undefined },
      });
      toast.success(t("harness.supervisor.wakeQueued"));
      setInstruction("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("settings.failedToSave"));
    } finally {
      setWaking(false);
    }
  };

  if (!state) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        {t("harness.loading")}
      </p>
    );
  }

  const paused = state.pausedUntil && new Date(state.pausedUntil) > new Date();

  return (
    <div className="space-y-5">
      {/* ── Masthead ── */}
      <div className="rounded-[4px] border-2 border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] border-2 border-border bg-card shadow-[3px_3px_0_var(--color-border)]">
              <Bot className="h-5 w-5 text-[#d97706]" />
            </div>
            <div className="max-w-2xl">
              <h3 className="font-serif text-lg font-black uppercase tracking-[0.03em]">
                {t("harness.supervisor.title")}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("harness.supervisor.desc")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="supervisor-enabled"
              checked={state.enabled}
              onCheckedChange={(v) => void patch({ enabled: v })}
            />
            <Label
              htmlFor="supervisor-enabled"
              className="font-mono text-[10px] uppercase tracking-wider"
            >
              {state.enabled
                ? t("harness.supervisor.enabled")
                : t("harness.supervisor.off")}
            </Label>
          </div>
        </div>

        {!state.enabled && (
          <p className="mt-3 rounded-[3px] border-l-2 border-[#d97706] bg-[#d97706]/[0.06] px-3 py-2 text-sm text-muted-foreground">
            {t("harness.supervisor.offDesc")}
          </p>
        )}
        {!state.providerConfigured && (
          <p className="mt-3 rounded-[3px] border-l-2 border-rose-500 bg-rose-500/[0.06] px-3 py-2 text-sm">
            {t("harness.supervisor.providerMissing")}
          </p>
        )}
        {/* A run of quiet wakes is not a fault, but it is a signal, and it is
            the operator who can act on either explanation. */}
        {state.consecutiveNoops >= 3 && (
          <p className="mt-3 rounded-[3px] border-l-2 border-sky-500 bg-sky-500/[0.06] px-3 py-2 text-sm text-muted-foreground">
            {t("harness.supervisor.noopWarning", {
              count: String(state.consecutiveNoops),
            })}
          </p>
        )}
      </div>

      {/* ── Pacing and spend ── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <HarnessStatTile
          label={t("harness.supervisor.nextWake")}
          accent={state.enabled && !paused ? "amber" : "none"}
          value={
            <span className="text-sm">
              {paused
                ? t("harness.supervisor.nextWakeNever")
                : !state.nextWakeAt
                  ? t("harness.supervisor.nextWakeNever")
                  : new Date(state.nextWakeAt) <= new Date()
                    ? t("harness.supervisor.nextWakeDue")
                    : formatRelative(state.nextWakeAt)}
            </span>
          }
        />
        <HarnessStatTile
          label={t("harness.supervisor.lastWake")}
          value={
            <span className="text-sm">
              {state.lastWakeAt
                ? formatRelative(state.lastWakeAt)
                : t("harness.supervisor.lastWakeNever")}
            </span>
          }
        />
        <HarnessStatTile
          label={t("harness.supervisor.spentToday")}
          value={
            <span className="text-sm">
              {state.budget.spentTodayUsd === null ||
              state.budget.spentTodayUsd === undefined
                ? t("harness.supervisor.costUnknown")
                : `$${state.budget.spentTodayUsd.toFixed(4)}${
                    state.budget.limitUsd
                      ? ` / $${state.budget.limitUsd.toFixed(2)}`
                      : ""
                  }`}
            </span>
          }
          accent={state.budget.exhausted ? "amber" : "none"}
        />
        <HarnessStatTile
          label={t("harness.supervisor.pendingEvents")}
          value={state.pendingEvents}
        />
      </div>

      {state.wakeReason && (
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {t("harness.supervisor.wakeReason")}: {state.wakeReason}
        </p>
      )}

      {/* ── Wake now ── */}
      <div className="space-y-2 rounded-[4px] border-2 border-border bg-card p-4">
        <Textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder={t("harness.supervisor.wakeInstruction")}
          rows={2}
          className="rounded-[4px] border-2 text-sm"
        />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => void wake()}
            disabled={waking || !state.providerConfigured}
          >
            <Play className="mr-1 h-3.5 w-3.5" />
            {t("harness.supervisor.wakeNow")}
          </Button>
          {paused ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void patch({ pausedUntil: null })}
            >
              <PlayCircle className="mr-1 h-3.5 w-3.5" />
              {t("harness.supervisor.resume")}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void patch({
                  pausedUntil: new Date(Date.now() + 86_400_000),
                })
              }
            >
              <PauseCircle className="mr-1 h-3.5 w-3.5" />
              {t("harness.supervisor.pause")}
            </Button>
          )}
          {paused && state.pausedUntil && (
            <span className="self-center font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("harness.supervisor.pausedUntil", {
                when: formatRelative(state.pausedUntil),
              })}
            </span>
          )}
        </div>
      </div>

      {/* ── Inner views ── */}
      <Tabs
        value={view}
        onValueChange={(v) => setView(v as Inner)}
        urlParam="sv"
        className="gap-5"
      >
        <TabsList
          variant="line"
          className="h-auto w-full flex-wrap justify-start gap-1 border-b-2 border-border p-0"
        >
          {(
            ["goals", "journal", "capabilities", "undo", "settings"] as const
          ).map((id) => (
            <TabsTrigger
              key={id}
              value={id}
              className="flex-none rounded-none border-b-2 border-transparent px-3 py-2 font-mono text-[11px] uppercase tracking-wider data-[state=active]:border-[#d97706] data-[state=active]:after:opacity-0"
            >
              {t(`harness.supervisor.tabs.${id}` as never)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="goals">
          <SupervisorGoals onChanged={() => void load()} />
        </TabsContent>
        <TabsContent value="journal">
          <SupervisorJournal />
        </TabsContent>
        <TabsContent value="capabilities">
          <SupervisorCapabilities />
        </TabsContent>
        <TabsContent value="undo">
          <SupervisorUndo />
        </TabsContent>
        <TabsContent value="settings">
          <SupervisorLimits state={state} onSaved={setState} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SupervisorLimits({
  state,
  onSaved,
}: {
  state: SupervisorStateDto;
  onSaved: (s: SupervisorStateDto) => void;
}) {
  const { t } = useTranslation();
  const [cap, setCap] = React.useState(
    state.budget.limitUsd ? String(state.budget.limitUsd) : "",
  );
  const [purge, setPurge] = React.useState(
    String(state.budget.purgeBudgetPerDay),
  );

  const save = async () => {
    try {
      onSaved(
        await api.autopilot.supervisorControllerUpdate({
          updateSupervisorDto: {
            dailyCostLimitUsd: cap.trim() ? Number(cap) : null,
            purgeBudgetPerDay: Number(purge) || 0,
          },
        }),
      );
      toast.success(t("harness.supervisor.settings.saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("settings.failedToSave"));
    }
  };

  return (
    <div className="max-w-xl space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("harness.supervisor.settings.desc")}
      </p>

      <Field
        label={t("harness.supervisor.settings.dailyCap")}
        hint={t("harness.supervisor.settings.dailyCapHint")}
      >
        <Input
          value={cap}
          onChange={(e) => setCap(e.target.value)}
          inputMode="decimal"
          className="w-40 rounded-[4px] border-2 tabular-nums"
        />
      </Field>

      <Field
        label={t("harness.supervisor.settings.purgeBudget")}
        hint={t("harness.supervisor.settings.purgeBudgetHint")}
      >
        <Input
          value={purge}
          onChange={(e) => setPurge(e.target.value)}
          inputMode="numeric"
          className="w-40 rounded-[4px] border-2 tabular-nums"
        />
      </Field>

      <Button size="sm" onClick={() => void save()}>
        {t("harness.supervisor.settings.save")}
      </Button>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      {children}
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
