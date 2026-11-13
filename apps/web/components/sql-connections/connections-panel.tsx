"use client";

import { useState } from "react";
import {
  Ban,
  CircleSlash,
  KeyRound,
  Loader2,
  Plus,
  RotateCcw,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import { ActorChip } from "@/components/actor-chip";
import { formatDate, formatRelative } from "@/lib/date";
import { PrincipalPicker } from "@/components/governance/principal-picker";
import type { GovernancePrincipalDto } from "@/lib/governance";
import {
  blockConnection,
  createConnection,
  issueConnection,
  newPassword,
  revokeConnection,
  unblockConnection,
  useDataConnections,
  useSqlEndpoint,
  type ConnectionsScope,
  type DataConnectionDto,
  type DataConnectionSecretDto,
} from "@/lib/sql-connections";
import { ConnectDetails } from "./connect-details";

const EXPIRY_DAYS = [30, 90, 180, 365] as const;

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

const STATUS_TONE: Record<string, string> = {
  active: "bg-lime-100 text-lime-900 dark:bg-lime-900/40 dark:text-lime-200",
  pending: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  expired: "bg-muted text-muted-foreground",
  revoked: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200",
};

/**
 * SQL connections (docs/prd/DQ-data-query.md §5.7): who connects BI tools and
 * drivers, to what, when they last did, and the controls each viewer has —
 * their own passwords, revoking (their own, or anyone's for managers), and on
 * a table or source, giving a connection and closing it there (owners and
 * stewards).
 */
export function ConnectionsPanel({
  scope,
  target,
}: {
  scope: ConnectionsScope;
  /** On a table's or source's Governance tab: what issuing and blocking apply to. */
  target?: { type: "asset" | "source"; id: string; name: string };
}) {
  const { t } = useTranslation();
  const { data, loading, error, reload } = useDataConnections(scope);
  const endpoint = useSqlEndpoint();
  const [secret, setSecret] = useState<DataConnectionSecretDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const isMine = scope.kind === "mine";

  const act = async (id: string, run: () => Promise<unknown>, done: string) => {
    setBusy(id);
    try {
      await run();
      toast.success(done);
      await reload();
    } catch (caught) {
      toast.error(errorText(caught, t("sqlConnections.failed")));
    } finally {
      setBusy(null);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    );
  }
  if (error && !data) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {errorText(error, t("sqlConnections.failedToLoad"))}
        </AlertDescription>
      </Alert>
    );
  }
  const items = data?.items ?? [];
  const canIssue = Boolean(target && (data?.canGovern || data?.canManage));

  return (
    <div className="space-y-3" data-testid="sql-connections-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {target
            ? t("sqlConnections.onTarget", { name: target.name })
            : isMine
              ? t("sqlConnections.mineIntro")
              : t("sqlConnections.allIntro")}
        </p>
        <div className="flex gap-2">
          {isMine && data?.canCreate && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              {t("sqlConnections.create")}
            </Button>
          )}
          {canIssue && (
            <Button size="sm" variant="outline" onClick={() => setIssuing(true)}>
              <UserPlus className="mr-1.5 h-4 w-4" />
              {t("sqlConnections.issue")}
            </Button>
          )}
        </div>
      </div>
      {isMine && data && !data.canCreate && (
        <p className="text-xs text-muted-foreground">
          {t("sqlConnections.cannotCreate")}
        </p>
      )}

      {items.length === 0 ? (
        <p className="rounded-[4px] border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          {target ? t("sqlConnections.noneOnTarget") : t("sqlConnections.none")}
        </p>
      ) : (
        <ul className="divide-y rounded-[4px] border">
          {items.map((connection) => (
            <ConnectionRow
              key={connection.id}
              connection={connection}
              showPerson={!isMine}
              busy={busy === connection.id}
              target={target}
              canGovern={Boolean(data?.canGovern || data?.canManage)}
              onPassword={() =>
                void (async () => {
                  setBusy(connection.id);
                  try {
                    setSecret(await newPassword(connection.id));
                    await reload();
                  } catch (caught) {
                    toast.error(errorText(caught, t("sqlConnections.failed")));
                  } finally {
                    setBusy(null);
                  }
                })()
              }
              onRevoke={() =>
                void act(
                  connection.id,
                  () => revokeConnection(connection.id),
                  t("sqlConnections.revoked"),
                )
              }
              onBlock={() =>
                target &&
                void act(
                  connection.id,
                  () =>
                    blockConnection(connection.id, {
                      type: target.type,
                      id: target.id,
                    }),
                  t("sqlConnections.blocked", { name: target.name }),
                )
              }
              onUnblock={(blockId) =>
                void act(
                  connection.id,
                  () => unblockConnection(connection.id, blockId),
                  t("sqlConnections.unblocked"),
                )
              }
            />
          ))}
        </ul>
      )}

      <CreateDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(created) => {
          setSecret(created);
          void reload();
        }}
      />
      {target && (
        <IssueDialog
          open={issuing}
          onOpenChange={setIssuing}
          target={target}
          onIssued={() => void reload()}
        />
      )}
      <Dialog open={Boolean(secret)} onOpenChange={(open) => !open && setSecret(null)}>
        <DialogContent className="max-w-2xl" data-testid="sql-connection-secret">
          <DialogHeader>
            <DialogTitle>
              {t("sqlConnections.secretTitle", {
                name: secret?.connection.name ?? "",
              })}
            </DialogTitle>
            <DialogDescription>{t("sqlConnections.secretOnce")}</DialogDescription>
          </DialogHeader>
          {secret && (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label>{t("sqlConnections.password")}</Label>
                <code
                  className="block break-all rounded-[4px] border bg-muted/40 px-2 py-1.5 font-mono text-sm"
                  data-testid="sql-connection-password"
                >
                  {secret.password}
                </code>
              </div>
              <ConnectDetails
                endpoint={endpoint}
                username={secret.connection.username}
                password={secret.password}
              />
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setSecret(null)}>{t("sqlConnections.done")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConnectionRow({
  connection,
  showPerson,
  busy,
  target,
  canGovern,
  onPassword,
  onRevoke,
  onBlock,
  onUnblock,
}: {
  connection: DataConnectionDto;
  showPerson: boolean;
  busy: boolean;
  target?: { type: "asset" | "source"; id: string; name: string };
  canGovern: boolean;
  onPassword: () => void;
  onRevoke: () => void;
  onBlock: () => void;
  onUnblock: (blockId: string) => void;
}) {
  const { t } = useTranslation();
  const live = connection.status === "active" || connection.status === "pending";
  const blockedHere = target
    ? connection.blocks.find(
        (b) => b.type === target.type && b.scopeId === target.id,
      )
    : undefined;
  const mine = !showPerson;
  return (
    <li
      className="flex flex-wrap items-start gap-3 px-3 py-2.5"
      data-testid={`sql-connection-${connection.username}`}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{connection.name}</span>
          <code className="font-mono text-xs text-muted-foreground">
            {connection.username}
          </code>
          <Badge className={STATUS_TONE[connection.status]} variant="secondary">
            {t(`sqlConnections.status.${connection.status as "active" | "pending" | "expired" | "revoked"}`)}
          </Badge>
          {showPerson && <ActorChip actorRef={connection.personRef} />}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {connection.scope.length === 0 ? (
            <span>{t("sqlConnections.scopeAll")}</span>
          ) : (
            connection.scope.map((item) => (
              <Badge key={`${item.type}:${item.id}`} variant="outline" className="font-normal">
                {item.sqlName ?? item.name}
              </Badge>
            ))
          )}
          {connection.blocks.map((block) => (
            <Badge
              key={block.id}
              variant="outline"
              className="gap-1 border-red-300 font-normal text-red-700 dark:text-red-300"
            >
              <CircleSlash className="h-3 w-3" />
              {block.name}
              {canGovern && (
                <button
                  type="button"
                  className="ml-0.5"
                  aria-label={t("sqlConnections.unblock")}
                  onClick={() => onUnblock(block.id)}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          {connection.reads && (
            <span>
              {t("sqlConnections.reads", { count: connection.reads.count })}
              {connection.reads.lastAt
                ? ` · ${formatRelative(connection.reads.lastAt)}`
                : ""}
            </span>
          )}
          <span>
            {connection.lastUsedAt
              ? t("sqlConnections.lastUsed", {
                  when: formatRelative(connection.lastUsedAt),
                  from: connection.lastUsedIp ?? "?",
                })
              : t("sqlConnections.neverUsed")}
          </span>
          <span>
            {connection.status === "revoked" && connection.revokedAt
              ? t("sqlConnections.revokedAt", { when: formatDate(connection.revokedAt) })
              : t("sqlConnections.expires", { when: formatDate(connection.expiresAt) })}
          </span>
          {connection.issuedBy && (
            <span className="inline-flex items-center gap-1">
              {t("sqlConnections.issuedBy")} <ActorChip actorRef={connection.issuedBy} />
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-1.5">
        {busy && <Loader2 className="h-4 w-4 animate-spin self-center" />}
        {mine && live && (
          <Button size="sm" variant="outline" disabled={busy} onClick={onPassword}>
            {connection.status === "pending" ? (
              <KeyRound className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            )}
            {connection.status === "pending"
              ? t("sqlConnections.reveal")
              : t("sqlConnections.newPassword")}
          </Button>
        )}
        {target && canGovern && live && !blockedHere && (
          <Button size="sm" variant="outline" disabled={busy} onClick={onBlock}>
            <CircleSlash className="mr-1.5 h-3.5 w-3.5" />
            {t("sqlConnections.block")}
          </Button>
        )}
        {connection.canRevoke && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onRevoke}>
            <Ban className="mr-1.5 h-3.5 w-3.5" />
            {t("sqlConnections.revoke")}
          </Button>
        )}
      </div>
    </li>
  );
}

function ExpirySelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (days: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {EXPIRY_DAYS.map((days) => (
          <SelectItem key={days} value={String(days)}>
            {t("sqlConnections.days", { count: days })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (created: DataConnectionSecretDto) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [days, setDays] = useState(90);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const created = await createConnection({ name: name.trim(), expiresInDays: days });
      onOpenChange(false);
      setName("");
      onCreated(created);
    } catch (caught) {
      toast.error(errorText(caught, t("sqlConnections.failed")));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("sqlConnections.createTitle")}</DialogTitle>
          <DialogDescription>{t("sqlConnections.createIntro")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="sql-connection-name">{t("sqlConnections.name")}</Label>
            <Input
              id="sql-connection-name"
              value={name}
              placeholder="Power BI"
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
            />
          </div>
          <div className="space-y-1">
            <Label>{t("sqlConnections.expiresIn")}</Label>
            <ExpirySelect value={days} onChange={setDays} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("sqlConnections.cancel")}
          </Button>
          <Button disabled={!name.trim() || saving} onClick={() => void submit()}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {t("sqlConnections.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IssueDialog({
  open,
  onOpenChange,
  target,
  onIssued,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: { type: "asset" | "source"; id: string; name: string };
  onIssued: () => void;
}) {
  const { t } = useTranslation();
  const [person, setPerson] = useState<GovernancePrincipalDto | null>(null);
  const [name, setName] = useState("");
  const [days, setDays] = useState(90);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!person || !name.trim()) return;
    setSaving(true);
    try {
      await issueConnection({
        personRef: person.ref,
        name: name.trim(),
        expiresInDays: days,
        scope: [`${target.type}:${target.id}`],
      });
      toast.success(t("sqlConnections.issued", { name: person.displayName }));
      onOpenChange(false);
      setPerson(null);
      setName("");
      onIssued();
    } catch (caught) {
      toast.error(errorText(caught, t("sqlConnections.failed")));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("sqlConnections.issueTitle", { name: target.name })}</DialogTitle>
          <DialogDescription>{t("sqlConnections.issueIntro")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>{t("sqlConnections.person")}</Label>
            <PrincipalPicker kinds={["user"]} value={person} onChange={setPerson} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sql-issue-name">{t("sqlConnections.name")}</Label>
            <Input
              id="sql-issue-name"
              value={name}
              placeholder="Power BI"
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>{t("sqlConnections.expiresIn")}</Label>
            <ExpirySelect value={days} onChange={setDays} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("sqlConnections.cancel")}
          </Button>
          <Button disabled={!person || !name.trim() || saving} onClick={() => void submit()}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {t("sqlConnections.issue")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
