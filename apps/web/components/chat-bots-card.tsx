"use client";

import * as React from "react";
import {
  api,
  type ChatBotDiagnosticsDto,
  type ChatBotResponseDto,
  type ChatBotTestResultDto,
  type CreateChatBotDto,
  type McpCapabilityGroupDto,
  CreateChatBotDtoPlatformEnum,
} from "@workspace/api-client";

type AgentKindValue = NonNullable<CreateChatBotDto["agentKinds"]>[number];
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Switch,
} from "@workspace/ui/components";
import {
  Activity,
  Bot,
  CheckCircle2,
  Hash,
  Loader2,
  MessageSquare,
  Pencil,
  PlugZap,
  Plus,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useChatBots } from "@/hooks/use-chat-bots";
import { useTranslation } from "@/hooks/use-translation";

const AGENT_KINDS: AgentKindValue[] = [
  "INQUIRY",
  "CASE",
  "CONFIG",
  "DETECTOR_AUTHOR",
  "DREAM",
  "DUPLICATES",
];

const DIAGNOSTICS_POLL_MS = 5000;

const CHECK_LABEL_KEYS = {
  botToken: "chatBots.checkBotToken",
  appToken: "chatBots.checkAppToken",
  polling: "chatBots.checkPolling",
} as const;

/** Server event/check codes → translation keys ({{param}} interpolation). */
const EVENT_CODE_KEYS = {
  connectorStarted: "chatBots.eventConnectorStarted",
  connectorStartFailed: "chatBots.eventConnectorStartFailed",
  socketConnected: "chatBots.eventSocketConnected",
  socketDisconnected: "chatBots.eventSocketDisconnected",
  slackAuthenticated: "chatBots.eventSlackAuthenticated",
  slackMention: "chatBots.eventSlackMention",
  slackThreadMessage: "chatBots.eventSlackThreadMessage",
  slackReplyPosted: "chatBots.eventSlackReplyPosted",
  eventFailed: "chatBots.eventFailed",
  telegramAuthenticated: "chatBots.eventTelegramAuthenticated",
  telegramPollFailed: "chatBots.eventTelegramPollFailed",
  telegramMessage: "chatBots.eventTelegramMessage",
  telegramReplySent: "chatBots.eventTelegramReplySent",
  processing: "chatBots.eventProcessing",
  turnFailed: "chatBots.eventTurnFailed",
  telegramTokenRejected: "chatBots.eventTelegramTokenRejected",
  telegramWebhookConflict: "chatBots.eventTelegramWebhookConflict",
  telegramPollingOk: "chatBots.eventTelegramPollingOk",
  telegramWebhookInfoFailed: "chatBots.eventTelegramWebhookInfoFailed",
  slackBotTokenRejected: "chatBots.eventSlackBotTokenRejected",
  slackAppTokenMissing: "chatBots.eventSlackAppTokenMissing",
  slackAppTokenOk: "chatBots.eventSlackAppTokenOk",
  slackAppTokenRejected: "chatBots.eventSlackAppTokenRejected",
} as const;

/** Translate a server event; fall back to its pre-rendered English text. */
function useEventText() {
  const { t } = useTranslation();
  return React.useCallback(
    (code: string, params: Record<string, string>, fallback: string) => {
      const key = EVENT_CODE_KEYS[code as keyof typeof EVENT_CODE_KEYS];
      return key ? t(key, params) : fallback;
    },
    [t],
  );
}

type BotDraft = {
  platform: "TELEGRAM" | "SLACK";
  name: string;
  botToken: string;
  appToken: string;
  enabled: boolean;
  capabilityGroups: string[];
  agentKinds: AgentKindValue[];
  allowMutations: boolean;
};

const EMPTY_DRAFT: BotDraft = {
  platform: "TELEGRAM",
  name: "",
  botToken: "",
  appToken: "",
  enabled: true,
  capabilityGroups: [],
  agentKinds: [],
  allowMutations: true,
};

function draftFromBot(bot: ChatBotResponseDto): BotDraft {
  return {
    platform: bot.platform,
    name: bot.name,
    botToken: "",
    appToken: "",
    enabled: bot.enabled,
    capabilityGroups: bot.capabilityGroups,
    agentKinds: bot.agentKinds.filter((k): k is AgentKindValue =>
      (AGENT_KINDS as string[]).includes(k),
    ),
    allowMutations: bot.allowMutations,
  };
}

export function ChatBotsCard() {
  const { t } = useTranslation();
  const { bots, loading, error, refresh } = useChatBots();

  const [groups, setGroups] = React.useState<McpCapabilityGroupDto[]>([]);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ChatBotResponseDto | null>(null);
  const [draft, setDraft] = React.useState<BotDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = React.useState(false);
  const [deleteTarget, setDeleteTarget] =
    React.useState<ChatBotResponseDto | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  React.useEffect(() => {
    api.instanceSettings
      .mcpSettingsControllerGetOverview()
      .then((overview) => setGroups(overview.capabilityGroups))
      .catch(() => setGroups([]));
  }, []);

  const openCreate = () => {
    setEditing(null);
    setDraft(EMPTY_DRAFT);
    setFormOpen(true);
  };

  const openEdit = (bot: ChatBotResponseDto) => {
    setEditing(bot);
    setDraft(draftFromBot(bot));
    setFormOpen(true);
  };

  const toggleInList = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editing) {
        await api.chatBots.chatBotsControllerUpdate({
          id: editing.id,
          updateChatBotDto: {
            name: draft.name,
            botToken: draft.botToken || undefined,
            appToken: draft.appToken || undefined,
            enabled: draft.enabled,
            capabilityGroups: draft.capabilityGroups,
            agentKinds: draft.agentKinds,
            allowMutations: draft.allowMutations,
          },
        });
        toast.success(t("chatBots.updated"));
      } else {
        await api.chatBots.chatBotsControllerCreate({
          createChatBotDto: {
            platform:
              draft.platform === "SLACK"
                ? CreateChatBotDtoPlatformEnum.Slack
                : CreateChatBotDtoPlatformEnum.Telegram,
            name: draft.name,
            botToken: draft.botToken,
            appToken: draft.appToken || undefined,
            enabled: draft.enabled,
            capabilityGroups: draft.capabilityGroups,
            agentKinds: draft.agentKinds,
            allowMutations: draft.allowMutations,
          },
        });
        toast.success(t("chatBots.created"));
      }
      setFormOpen(false);
      await refresh();
    } catch (saveError) {
      toast.error(
        saveError instanceof Error ? saveError.message : t("chatBots.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.chatBots.chatBotsControllerRemove({ id: deleteTarget.id });
      toast.success(t("chatBots.deleted"));
      setDeleteTarget(null);
      await refresh();
    } catch (deleteError) {
      toast.error(
        deleteError instanceof Error
          ? deleteError.message
          : t("chatBots.deleteFailed"),
      );
    } finally {
      setDeleting(false);
    }
  };

  const isSlack = draft.platform === "SLACK";
  const canSave =
    draft.name.trim().length > 0 &&
    (editing !== null || draft.botToken.trim().length > 0) &&
    (!isSlack || editing !== null || draft.appToken.trim().length > 0);

  return (
    <Card className="panel-card rounded-[6px]">
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            <p className="text-xs font-mono uppercase tracking-[0.14em]">
              {t("chatBots.heading")}
            </p>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t("chatBots.addBot")}
          </Button>
        </div>
        <CardTitle>{t("chatBots.title")}</CardTitle>
        <CardDescription>{t("chatBots.desc")}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4 p-5">
        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("common.loading")}
          </div>
        ) : bots.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("chatBots.empty")}</p>
        ) : (
          <ul className="space-y-3">
            {bots.map((bot) => (
              <BotRow
                key={bot.id}
                bot={bot}
                onEdit={() => openEdit(bot)}
                onDelete={() => setDeleteTarget(bot)}
              />
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? t("chatBots.editBot") : t("chatBots.addBot")}
            </DialogTitle>
            <DialogDescription>{t("chatBots.dialogDesc")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {editing === null ? (
              <div className="grid grid-cols-2 gap-2">
                <PlatformTile
                  icon={<Send className="h-4 w-4" />}
                  label="Telegram"
                  detail={t("chatBots.telegramTileDesc")}
                  selected={!isSlack}
                  onSelect={() =>
                    setDraft((d) => ({ ...d, platform: "TELEGRAM" }))
                  }
                />
                <PlatformTile
                  icon={<Hash className="h-4 w-4" />}
                  label="Slack"
                  detail={t("chatBots.slackTileDesc")}
                  selected={isSlack}
                  onSelect={() => setDraft((d) => ({ ...d, platform: "SLACK" }))}
                />
              </div>
            ) : (
              <Badge variant="outline" className="font-mono text-[10px] uppercase">
                {editing.platform}
              </Badge>
            )}

            <div className="grid gap-2">
              <Label>{t("chatBots.name")}</Label>
              <Input
                value={draft.name}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, name: e.target.value }))
                }
                placeholder={
                  isSlack
                    ? t("chatBots.slackNamePlaceholder")
                    : t("chatBots.telegramNamePlaceholder")
                }
              />
            </div>

            {isSlack ? (
              <>
                <div className="grid gap-2">
                  <Label>{t("chatBots.slackBotToken")}</Label>
                  <Input
                    type="password"
                    value={draft.botToken}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, botToken: e.target.value }))
                    }
                    placeholder={
                      editing ? editing.botTokenPreview : "xoxb-…"
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("chatBots.slackBotTokenHint")}
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label>{t("chatBots.slackAppToken")}</Label>
                  <Input
                    type="password"
                    value={draft.appToken}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, appToken: e.target.value }))
                    }
                    placeholder={editing?.appTokenPreview ?? "xapp-…"}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("chatBots.slackAppTokenHint")}
                  </p>
                </div>
                <div className="rounded-[4px] border-2 border-border bg-muted/40 p-3">
                  <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em]">
                    {t("chatBots.slackChecklistTitle")}
                  </p>
                  <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                    <li>{t("chatBots.slackChecklistSocket")}</li>
                    <li>{t("chatBots.slackChecklistEvents")}</li>
                    <li>{t("chatBots.slackChecklistScopes")}</li>
                    <li>{t("chatBots.slackChecklistInvite")}</li>
                  </ul>
                </div>
              </>
            ) : (
              <div className="grid gap-2">
                <Label>{t("chatBots.telegramBotToken")}</Label>
                <Input
                  type="password"
                  value={draft.botToken}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, botToken: e.target.value }))
                  }
                  placeholder={
                    editing
                      ? editing.botTokenPreview
                      : "123456789:AA…"
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {t("chatBots.telegramBotTokenHint")}
                </p>
              </div>
            )}

            <div className="flex items-center justify-between rounded-[4px] border-2 border-border p-3">
              <div>
                <p className="text-sm font-medium">{t("chatBots.enabled")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("chatBots.enabledHint")}
                </p>
              </div>
              <Switch
                checked={draft.enabled}
                onCheckedChange={(checked) =>
                  setDraft((d) => ({ ...d, enabled: checked === true }))
                }
              />
            </div>

            <div className="flex items-center justify-between rounded-[4px] border-2 border-border p-3">
              <div>
                <p className="text-sm font-medium">
                  {t("chatBots.allowMutations")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("chatBots.allowMutationsHint")}
                </p>
              </div>
              <Switch
                checked={draft.allowMutations}
                onCheckedChange={(checked) =>
                  setDraft((d) => ({ ...d, allowMutations: checked === true }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label>{t("chatBots.capabilityGroups")}</Label>
              <p className="text-xs text-muted-foreground">
                {t("chatBots.capabilityGroupsHint")}
              </p>
              <div className="grid gap-2">
                {groups.map((group) => {
                  const allSelected = draft.capabilityGroups.length === 0;
                  const checked =
                    allSelected || draft.capabilityGroups.includes(group.id);
                  return (
                    <label
                      key={group.id}
                      className="flex items-start gap-2 text-sm"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() =>
                          setDraft((d) => ({
                            ...d,
                            capabilityGroups: allSelected
                              ? groups
                                  .map((g) => g.id)
                                  .filter((id) => id !== group.id)
                              : toggleInList(d.capabilityGroups, group.id),
                          }))
                        }
                      />
                      <span>
                        <span className="font-medium">{group.title}</span>{" "}
                        <span className="text-xs text-muted-foreground">
                          {group.description}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t("chatBots.agents")}</Label>
              <p className="text-xs text-muted-foreground">
                {t("chatBots.agentsHint")}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {AGENT_KINDS.map((kind) => {
                  const allSelected = draft.agentKinds.length === 0;
                  const checked = allSelected || draft.agentKinds.includes(kind);
                  return (
                    <label key={kind} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() =>
                          setDraft((d) => ({
                            ...d,
                            agentKinds: allSelected
                              ? AGENT_KINDS.filter((k) => k !== kind)
                              : toggleInList(d.agentKinds, kind),
                          }))
                        }
                      />
                      <span className="font-mono text-xs">{kind}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setFormOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={() => void handleSave()} disabled={!canSave || saving}>
                {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                {editing ? t("common.save") : t("common.create")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => (!open ? setDeleteTarget(null) : undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("chatBots.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("chatBots.deleteDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function PlatformTile({
  icon,
  label,
  detail,
  selected,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex flex-col items-start gap-1 rounded-[4px] border-2 p-3 text-left transition-colors ${
        selected
          ? "border-primary bg-primary/5"
          : "border-border hover:border-muted-foreground/40"
      }`}
    >
      <span className="flex items-center gap-2">
        {icon}
        <span className="font-mono text-xs uppercase tracking-[0.14em]">
          {label}
        </span>
      </span>
      <span className="text-xs text-muted-foreground">{detail}</span>
    </button>
  );
}

function BotRow({
  bot,
  onEdit,
  onDelete,
}: {
  bot: ChatBotResponseDto;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const eventText = useEventText();
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] =
    React.useState<ChatBotTestResultDto | null>(null);
  const [activityOpen, setActivityOpen] = React.useState(false);
  const [diagnostics, setDiagnostics] =
    React.useState<ChatBotDiagnosticsDto | null>(null);

  const loadDiagnostics = React.useCallback(async () => {
    try {
      setDiagnostics(
        await api.chatBots.chatBotsControllerDiagnostics({ id: bot.id }),
      );
    } catch {
      // transient — keep the last snapshot
    }
  }, [bot.id]);

  React.useEffect(() => {
    if (!activityOpen) return;
    void loadDiagnostics();
    const timer = setInterval(() => void loadDiagnostics(), DIAGNOSTICS_POLL_MS);
    return () => clearInterval(timer);
  }, [activityOpen, loadDiagnostics]);

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await api.chatBots.chatBotsControllerTest({ id: bot.id }));
    } catch (testError) {
      toast.error(
        testError instanceof Error ? testError.message : t("chatBots.testFailed"),
      );
    } finally {
      setTesting(false);
    }
  };

  return (
    <li className="rounded-[4px] border-2 border-border">
      <div className="flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {bot.platform === "SLACK" ? (
              <Hash className="h-4 w-4 shrink-0" />
            ) : (
              <Send className="h-4 w-4 shrink-0" />
            )}
            <span className="font-medium">{bot.name}</span>
            <Badge variant="outline" className="font-mono text-[10px] uppercase">
              {bot.platform}
            </Badge>
            {bot.enabled ? (
              bot.lastError ? (
                <Badge variant="destructive" className="text-[10px] uppercase">
                  {t("chatBots.errorBadge")}
                </Badge>
              ) : (
                <Badge className="text-[10px] uppercase">
                  {t("chatBots.connected")}
                </Badge>
              )
            ) : (
              <Badge variant="secondary" className="text-[10px] uppercase">
                {t("chatBots.disabledBadge")}
              </Badge>
            )}
            {!bot.allowMutations ? (
              <Badge variant="outline" className="text-[10px] uppercase">
                {t("chatBots.readOnly")}
              </Badge>
            ) : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {bot.lastError
              ? bot.lastError
              : bot.lastConnectedAt
                ? `${t("chatBots.lastConnected")}: ${new Date(bot.lastConnectedAt).toLocaleString()}`
                : t("chatBots.neverConnected")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("chatBots.tokenLabel")}: {bot.botTokenPreview}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void runTest()}
            disabled={testing}
          >
            {testing ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <PlugZap className="mr-1 h-3.5 w-3.5" />
            )}
            {t("chatBots.testConnection")}
          </Button>
          <Button
            variant={activityOpen ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setActivityOpen((open) => !open)}
          >
            <Activity className="mr-1 h-3.5 w-3.5" />
            {t("chatBots.activity")}
          </Button>
          <Button variant="ghost" size="icon" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {testResult ? (
        <div className="space-y-1.5 border-t-2 border-border p-3">
          {testResult.checks.map((check) => (
            <div key={check.id} className="flex items-start gap-2 text-xs">
              {check.ok ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
              ) : (
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              )}
              <span>
                <span className="font-mono uppercase">
                  {t(
                    CHECK_LABEL_KEYS[
                      check.id as keyof typeof CHECK_LABEL_KEYS
                    ] ?? "chatBots.checkGeneric",
                  )}
                </span>{" "}
                <span className="text-muted-foreground">
                  {eventText(check.code, check.params, check.detail)}
                </span>
              </span>
            </div>
          ))}
          {testResult.ok && bot.platform === "SLACK" ? (
            <p className="pt-1 text-xs text-muted-foreground">
              {t("chatBots.slackTestOkHint")}
            </p>
          ) : null}
        </div>
      ) : null}

      {activityOpen ? (
        <div className="border-t-2 border-border p-3">
          {diagnostics === null ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("common.loading")}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
                <span>
                  {t("chatBots.connectorStatus")}:{" "}
                  <span
                    className={
                      diagnostics.running ? "text-emerald-600" : "text-destructive"
                    }
                  >
                    {diagnostics.running
                      ? t("chatBots.running")
                      : t("chatBots.stopped")}
                  </span>
                </span>
                {diagnostics.processing ? (
                  <span className="animate-pulse text-amber-600">
                    {t("chatBots.processingLabel")}
                  </span>
                ) : null}
                <span>
                  {t("chatBots.eventsReceived")}: {diagnostics.eventsReceived}
                </span>
                <span>
                  {t("chatBots.repliesSent")}: {diagnostics.repliesSent}
                </span>
                {diagnostics.lastEventAt ? (
                  <span>
                    {t("chatBots.lastEvent")}:{" "}
                    {new Date(diagnostics.lastEventAt).toLocaleTimeString()}
                  </span>
                ) : null}
              </div>
              {diagnostics.activity.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("chatBots.noActivity")}
                </p>
              ) : (
                <ul className="max-h-48 space-y-1 overflow-y-auto rounded-[4px] bg-muted/40 p-2 font-mono text-[11px]">
                  {diagnostics.activity.map((entry, index) => (
                    <li
                      key={`${entry.at instanceof Date ? entry.at.toISOString() : String(entry.at)}-${index}`}
                      className={
                        entry.level === "ERROR"
                          ? "text-destructive"
                          : "text-muted-foreground"
                      }
                    >
                      {new Date(entry.at).toLocaleTimeString()} ·{" "}
                      {eventText(entry.code, entry.params, entry.message)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}
