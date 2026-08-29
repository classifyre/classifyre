"use client";

import * as React from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import {
  api,
  type SupervisorGoalDto,
  SupervisorGoalDtoKindEnum,
  SupervisorGoalDtoOriginEnum,
  SupervisorGoalDtoStatusEnum,
} from "@workspace/api-client";
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";

const STATUSES = [
  SupervisorGoalDtoStatusEnum.Active,
  SupervisorGoalDtoStatusEnum.Paused,
  SupervisorGoalDtoStatusEnum.Done,
  SupervisorGoalDtoStatusEnum.Abandoned,
] as const;

/**
 * Goals and the charter.
 *
 * The charter is separated from the rest and rendered first because it is the
 * one goal that answers "what is this instance for" — everything else is
 * supposed to be traceable to it, and burying it in a list of tasks loses that.
 */
export function SupervisorGoals({ onChanged }: { onChanged?: () => void }) {
  const { t } = useTranslation();
  const [goals, setGoals] = React.useState<SupervisorGoalDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [showFinished, setShowFinished] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [editing, setEditing] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await api.autopilot.supervisorControllerGoals({
        includeFinished: showFinished ? "true" : "false",
      });
      setGoals(res.goals);
    } catch {
      /* transient */
    } finally {
      setLoading(false);
    }
  }, [showFinished]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const charter = goals.find(
    (g) => g.kind === SupervisorGoalDtoKindEnum.Charter,
  );
  const rest = goals.filter((g) => g.kind !== SupervisorGoalDtoKindEnum.Charter);

  const refresh = async () => {
    await load();
    onChanged?.();
  };

  if (loading) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        {t("harness.loading")}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted-foreground">
        {t("harness.supervisor.goals.desc")}
      </p>

      {charter && (
        <GoalCard
          goal={charter}
          isCharter
          editing={editing === charter.id}
          onEdit={() => setEditing(charter.id)}
          onDone={() => {
            setEditing(null);
            void refresh();
          }}
        />
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Switch
            id="show-finished"
            checked={showFinished}
            onCheckedChange={setShowFinished}
          />
          <Label
            htmlFor="show-finished"
            className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
          >
            {t("harness.supervisor.goals.showFinished")}
          </Label>
        </div>
        {!adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t("harness.supervisor.goals.add")}
          </Button>
        )}
      </div>

      {adding && (
        <GoalEditor
          onCancel={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            void refresh();
          }}
        />
      )}

      {rest.length === 0 && !adding ? (
        <p className="rounded-[4px] border-2 border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {t("harness.supervisor.goals.empty")}
        </p>
      ) : (
        <div className="space-y-3">
          {rest.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              editing={editing === goal.id}
              onEdit={() => setEditing(goal.id)}
              onDone={() => {
                setEditing(null);
                void refresh();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function GoalCard({
  goal,
  isCharter = false,
  editing,
  onEdit,
  onDone,
}: {
  goal: SupervisorGoalDto;
  isCharter?: boolean;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();

  if (editing) {
    return <GoalEditor goal={goal} onCancel={onDone} onSaved={onDone} />;
  }

  const remove = async () => {
    try {
      await api.autopilot.supervisorControllerDeleteGoal({ id: goal.id });
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("settings.failedToSave"));
    }
  };

  return (
    <div
      className={cn(
        "rounded-[4px] border-2 p-4",
        isCharter
          ? "border-[#d97706]/40 bg-[#d97706]/[0.04]"
          : "border-border bg-card",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-[3px] border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              {t(
                `harness.supervisor.goals.kinds.${goal.kind}` as TranslationKey,
              )}
            </span>
            {!isCharter && (
              <span className="rounded-[3px] border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                {t(
                  `harness.supervisor.goals.statuses.${goal.status}` as TranslationKey,
                )}
              </span>
            )}
            <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              {goal.origin === SupervisorGoalDtoOriginEnum.Operator
                ? t("harness.supervisor.goals.byOperator")
                : t("harness.supervisor.goals.byAgent")}
            </span>
          </div>
          <h4 className="font-serif text-base font-black uppercase tracking-[0.03em]">
            {goal.title}
          </h4>
          {isCharter && (
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("harness.supervisor.goals.charterHint")}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button size="icon" variant="ghost" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          {!isCharter && (
            <Button size="icon" variant="ghost" onClick={() => void remove()}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {goal.body && (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
          {goal.body}
        </p>
      )}

      {/* The agent's own account of where this stands, kept visually distinct
          from what the operator wrote so the two are never confused. */}
      {goal.progress && (
        <div className="mt-3 rounded-[3px] border-l-2 border-[#d97706]/50 bg-muted/30 px-3 py-2">
          <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            {t("harness.supervisor.goals.progress")}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{goal.progress}</p>
        </div>
      )}
    </div>
  );
}

function GoalEditor({
  goal,
  onCancel,
  onSaved,
}: {
  goal?: SupervisorGoalDto;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = React.useState(goal?.title ?? "");
  const [body, setBody] = React.useState(goal?.body ?? "");
  const [status, setStatus] = React.useState(
    goal?.status ?? SupervisorGoalDtoStatusEnum.Active,
  );
  const [priority, setPriority] = React.useState(String(goal?.priority ?? 0));
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      if (goal) {
        await api.autopilot.supervisorControllerUpdateGoal({
          id: goal.id,
          updateSupervisorGoalDto: {
            title: title.trim(),
            body: body.trim() || null,
            status,
            priority: Number(priority) || 0,
          },
        });
      } else {
        await api.autopilot.supervisorControllerCreateGoal({
          createSupervisorGoalDto: {
            title: title.trim(),
            body: body.trim() || null,
            priority: Number(priority) || 0,
          },
        });
      }
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("settings.failedToSave"));
    } finally {
      setSaving(false);
    }
  };

  const isCharter = goal?.kind === SupervisorGoalDtoKindEnum.Charter;

  return (
    <div className="space-y-3 rounded-[4px] border-2 border-[#d97706]/40 bg-[#d97706]/[0.04] p-4">
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("harness.supervisor.goals.titlePlaceholder")}
        className="rounded-[4px] border-2"
      />
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t("harness.supervisor.goals.bodyPlaceholder")}
        rows={isCharter ? 14 : 4}
        className="rounded-[4px] border-2 font-mono text-xs"
      />
      {goal && !isCharter && (
        <div className="flex flex-wrap gap-3">
          <div className="space-y-1">
            <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("harness.supervisor.goals.statuses.ACTIVE")}
            </Label>
            <Select
              value={status}
              onValueChange={(v) =>
                setStatus(v as SupervisorGoalDtoStatusEnum)
              }
            >
              <SelectTrigger className="w-44 rounded-[4px] border-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(
                      `harness.supervisor.goals.statuses.${s}` as TranslationKey,
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("harness.supervisor.goals.priority")}
            </Label>
            <Input
              type="number"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-24 rounded-[4px] border-2 tabular-nums"
            />
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          {t("harness.supervisor.goals.save")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <X className="mr-1 h-3.5 w-3.5" />
          {t("harness.supervisor.goals.cancel")}
        </Button>
      </div>
    </div>
  );
}
