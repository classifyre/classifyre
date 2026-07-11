"use client";

import * as React from "react";
import {
  api,
  type McpTokenCreatedResponseDto,
  type McpOverviewResponseDto,
  type McpTokenResponseDto,
} from "@workspace/api-client";
import {
  Alert,
  AlertDescription,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Switch,
} from "@workspace/ui/components";
import {
  Copy,
  Eye,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { formatDate, formatRelative } from "@/lib/date";
import { useInstanceSettings } from "@/components/instance-settings-provider";
import { useServerConfig } from "@/components/dashboard-layout";
import { useTranslation } from "@/hooks/use-translation";

type RevealState = {
  name: string;
  token: string;
  preview: string;
};

type EditableToken = {
  id: string;
  name: string;
  isActive: boolean;
};

function sortTokens(tokens: McpTokenResponseDto[]): McpTokenResponseDto[] {
  return [...tokens].sort(
    (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
  );
}

function toStoredToken(
  created: McpTokenCreatedResponseDto,
): McpTokenResponseDto {
  const { plainTextToken: _plainTextToken, ...token } = created;
  return token;
}

function getAbsoluteEndpoint(
  endpointPath: string,
  origin: string | null,
): string {
  if (!origin) {
    return endpointPath;
  }

  try {
    return new URL(endpointPath, origin).toString();
  } catch {
    return endpointPath;
  }
}

async function copyToClipboard(value: string): Promise<void> {
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function statusTone(isActive: boolean) {
  return isActive ? "default" : "outline";
}

export function McpSettingsCard() {
  const { t } = useTranslation();
  const {
    settings,
    saving: savingGlobal,
    updateSettings,
  } = useInstanceSettings();
  const { demoMode } = useServerConfig();
  const [togglingMcp, setTogglingMcp] = React.useState(false);

  const [overview, setOverview] = React.useState<McpOverviewResponseDto | null>(
    null,
  );
  const [tokens, setTokens] = React.useState<McpTokenResponseDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [createName, setCreateName] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [reveal, setReveal] = React.useState<RevealState | null>(null);

  const [editing, setEditing] = React.useState<EditableToken | null>(null);
  const [savingTokenId, setSavingTokenId] = React.useState<string | null>(null);
  const [deletingToken, setDeletingToken] =
    React.useState<McpTokenResponseDto | null>(null);
  const [origin, setOrigin] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (typeof window !== "undefined") {
      // In the desktop app the page origin is the app:// bundle, not the API —
      // the MCP endpoint clients must call is the per-workspace API server.
      const desktop = (
        window as unknown as {
          __CLASSIFYRE_DESKTOP__?: { apiBaseUrl?: string };
        }
      ).__CLASSIFYRE_DESKTOP__;
      setOrigin(desktop?.apiBaseUrl ?? window.location.origin);
    }
  }, []);

  const load = React.useCallback(async (background = false) => {
    try {
      if (background) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const [nextOverview, nextTokens] = await Promise.all([
        api.instanceSettings.mcpSettingsControllerGetOverview(),
        api.instanceSettings.mcpSettingsControllerListTokens(),
      ]);

      setOverview(nextOverview);
      setTokens(sortTokens(nextTokens));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : t("mcp.failedToLoad"),
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  React.useEffect(() => {
    void load(false);
  }, [load]);

  const endpointUrl = React.useMemo(() => {
    return getAbsoluteEndpoint(overview?.endpointPath ?? "/mcp", origin);
  }, [origin, overview?.endpointPath]);

  const handleCreateToken = React.useCallback(async () => {
    const name = createName.trim();
    if (!name) {
      toast.error(t("mcp.tokenNameRequired"));
      return;
    }

    try {
      setCreating(true);
      const created =
        await api.instanceSettings.mcpSettingsControllerCreateToken({
          createMcpTokenDto: {
            name,
          },
        });

      setTokens((current) => sortTokens([toStoredToken(created), ...current]));
      setReveal({
        name: created.name,
        token: created.plainTextToken,
        preview: created.tokenPreview,
      });
      setCreateName("");
      setCreateOpen(false);
      toast.success(t("mcp.tokenCreated"));
    } catch (createError) {
      toast.error(
        createError instanceof Error
          ? createError.message
          : "Failed to create MCP token",
      );
    } finally {
      setCreating(false);
    }
  }, [createName]);

  const handleCopy = React.useCallback(async (value: string, label: string) => {
    try {
      await copyToClipboard(value);
      toast.success(t("clipboard.copied", { label }));
    } catch (copyError) {
      toast.error(
        copyError instanceof Error
          ? copyError.message
          : t("clipboard.failedToCopy", { label }),
      );
    }
  }, [t]);

  const handleToggleToken = React.useCallback(
    async (token: McpTokenResponseDto) => {
      const nextActive = !token.isActive;

      try {
        setSavingTokenId(token.id);
        const updated =
          await api.instanceSettings.mcpSettingsControllerUpdateToken({
            id: token.id,
            updateMcpTokenDto: {
              isActive: nextActive,
            },
          });

        setTokens((current) =>
          sortTokens(
            current.map((item) => (item.id === updated.id ? updated : item)),
          ),
        );
        toast.success(
          nextActive ? t("mcp.tokenReactivated") : t("mcp.tokenRevoked"),
        );
      } catch (updateError) {
        toast.error(
          updateError instanceof Error
            ? updateError.message
            : "Failed to update token",
        );
      } finally {
        setSavingTokenId(null);
      }
    },
    [],
  );

  const handleSaveEdit = React.useCallback(async () => {
    if (!editing) {
      return;
    }

    const name = editing.name.trim();
    if (!name) {
      toast.error(t("mcp.tokenNameRequired"));
      return;
    }

    try {
      setSavingTokenId(editing.id);
      const updated =
        await api.instanceSettings.mcpSettingsControllerUpdateToken({
          id: editing.id,
          updateMcpTokenDto: {
            name,
            isActive: editing.isActive,
          },
        });

      setTokens((current) =>
        sortTokens(
          current.map((item) => (item.id === updated.id ? updated : item)),
        ),
      );
      setEditing(null);
      toast.success(t("mcp.tokenUpdated"));
    } catch (updateError) {
      toast.error(
        updateError instanceof Error
          ? updateError.message
          : "Failed to update token",
      );
    } finally {
      setSavingTokenId(null);
    }
  }, [editing]);

  const handleToggleMcp = React.useCallback(
    async (enabled: boolean) => {
      try {
        setTogglingMcp(true);
        await updateSettings({ mcpEnabled: enabled });
        toast.success(enabled ? t("mcp.enabled") : t("mcp.disabled"));
      } catch (toggleError) {
        toast.error(
          toggleError instanceof Error
            ? toggleError.message
            : "Failed to update MCP setting",
        );
      } finally {
        setTogglingMcp(false);
      }
    },
    [updateSettings],
  );

  const handleDeleteToken = React.useCallback(async () => {
    if (!deletingToken) {
      return;
    }

    try {
      setSavingTokenId(deletingToken.id);
      await api.instanceSettings.mcpSettingsControllerDeleteToken({
        id: deletingToken.id,
      });
      setTokens((current) =>
        current.filter((item) => item.id !== deletingToken.id),
      );
      setDeletingToken(null);
      toast.success(t("mcp.tokenDeleted"));
    } catch (deleteError) {
      toast.error(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete token",
      );
    } finally {
      setSavingTokenId(null);
    }
  }, [deletingToken]);

  return (
    <>
      <Card className="panel-card rounded-[6px]">
        <CardHeader className="gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4" />
                <p className="text-xs font-mono uppercase tracking-[0.14em]">
                  {t("mcp.title")}
                </p>
              </div>
              <CardTitle>{t("mcp.exposeDesc")}</CardTitle>
              <CardDescription>
                {t("mcp.exposeDescLong")}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Switch
                checked={settings.mcpEnabled}
                disabled={togglingMcp || savingGlobal}
                onCheckedChange={(checked) => {
                  void handleToggleMcp(checked);
                }}
                aria-label={t("mcp.enable")}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void load(true);
                }}
                disabled={loading || refreshing || !settings.mcpEnabled}
              >
                {refreshing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                {t("mcp.refresh")}
              </Button>
              <Button
                size="sm"
                onClick={() => setCreateOpen(true)}
                disabled={loading || !settings.mcpEnabled || demoMode}
              >
                <Plus className="h-3.5 w-3.5" />
                {t("mcp.createToken")}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {demoMode ? (
            <Alert className="border-amber-500/40 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-950/40">
              <Eye className="h-4 w-4 text-amber-700 dark:text-amber-400" />
              <AlertDescription className="text-amber-800 dark:text-amber-300">
                {t("demo.mcpNotice")}
              </AlertDescription>
            </Alert>
          ) : null}

          {!settings.mcpEnabled ? (
            <Alert className="border-muted/60 bg-muted/30">
              <ShieldOff className="h-4 w-4" />
              <AlertDescription>
                {t("mcp.disabledNotice")}
              </AlertDescription>
            </Alert>
          ) : null}

          {loading ? (
            <div className="flex min-h-32 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("mcp.loading")}
            </div>
          ) : null}

          {!loading && error ? (
            <Alert variant="destructive" className="border-destructive/40">
              <ShieldAlert className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {!loading && reveal ? (
            <Alert className="border-emerald-500/40 bg-emerald-500/10">
              <ShieldCheck className="h-4 w-4 text-emerald-700" />
              <AlertDescription className="space-y-3">
                <div className="space-y-1">
                  <p className="text-sm font-semibold">
                    {t("mcp.tokenReady", { name: reveal.name })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("mcp.tokenReadyDesc")}
                  </p>
                </div>

                <div className="rounded-[4px] border border-border bg-background p-3 font-mono text-xs break-all">
                  {reveal.token}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      void handleCopy(reveal.token, t("mcp.token"));
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {t("mcp.copyToken")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setReveal(null)}
                  >
                    {t("mcp.dismiss")}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {t("mcp.storedPreview", { preview: reveal.preview })}
                  </span>
                </div>
              </AlertDescription>
            </Alert>
          ) : null}

          {!loading && overview ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
              <div className="rounded-[6px] border-2 border-border bg-muted/20 p-4">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4" />
                  <p className="text-xs font-mono uppercase tracking-[0.14em]">
                    {t("mcp.connection")}
                  </p>
                </div>

                <div className="mt-4 grid gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                      {t("mcp.endpoint")}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <code className="rounded-[4px] border border-border bg-background px-2 py-1 text-xs">
                        {endpointUrl}
                      </code>
                      <Button
                        size="icon-xs"
                        variant="outline"
                        onClick={() => {
                          void handleCopy(endpointUrl, t("mcp.endpoint"));
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                        {t("mcp.transport")}
                      </p>
                      <p className="mt-1 text-sm font-medium">
                        {overview.transport}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                        {t("mcp.authorization")}
                      </p>
                      <p className="mt-1 text-sm font-medium">
                        {overview.authScheme}
                      </p>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                      {t("mcp.requestPattern")}
                    </p>
                    <div className="mt-1 rounded-[4px] border border-border bg-background p-3 font-mono text-xs">
                      <div>{`POST ${endpointUrl}`}</div>
                      <div>{`Authorization: Bearer ${overview.tokenPrefix}_<id>.<secret>`}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[6px] border-2 border-border bg-muted/20 p-4">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" />
                  <p className="text-xs font-mono uppercase tracking-[0.14em]">
                    {t("mcp.bestPractice")}
                  </p>
                </div>
                <div className="mt-4 grid gap-2">
                  {overview.bestPractices.map((practice) => (
                    <div
                      key={practice}
                      className="rounded-[4px] border border-border bg-background px-3 py-2 text-sm"
                    >
                      {practice}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {!loading ? (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" />
                <p className="text-xs font-mono uppercase tracking-[0.14em]">
                  {t("mcp.tokens")}
                </p>
              </div>

              {tokens.length === 0 ? (
                <div className="rounded-[6px] border border-dashed border-border bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
                  {t("mcp.noTokens")}
                </div>
              ) : (
                <div className="grid gap-3">
                  {tokens.map((token) => {
                    const isBusy = savingTokenId === token.id;

                    return (
                      <div
                        key={token.id}
                        className="rounded-[6px] border-2 border-border bg-muted/20 p-4"
                      >
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold">
                                {token.name}
                              </p>
                              <Badge variant={statusTone(token.isActive)}>
                                {token.isActive
                                  ? t("mcp.active")
                                  : t("mcp.revoked")}
                              </Badge>
                              {token.lastUsedAt ? (
                                <Badge variant="outline">
                                  {t("mcp.lastUsed", {
                                    relative: formatRelative(token.lastUsedAt),
                                  })}
                                </Badge>
                              ) : (
                                <Badge variant="outline">
                                  {t("mcp.neverUsed")}
                                </Badge>
                              )}
                            </div>

                            <div className="rounded-[4px] border border-border bg-background px-3 py-2 font-mono text-xs">
                              {token.tokenPreview}
                            </div>

                            <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
                              <p>
                                {t("mcp.created", {
                                  date: formatDate(token.createdAt),
                                })}
                              </p>
                              <p>
                                {t("mcp.updated", {
                                  date: formatDate(token.updatedAt),
                                })}
                              </p>
                              <p>
                                {token.revokedAt
                                  ? t("mcp.revokedAt", {
                                      date: formatDate(token.revokedAt),
                                    })
                                  : token.lastUsedAt
                                    ? t("mcp.usedAt", {
                                        date: formatDate(token.lastUsedAt),
                                      })
                                    : t("mcp.noAuthYet")}
                              </p>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={isBusy || demoMode}
                              onClick={() =>
                                setEditing({
                                  id: token.id,
                                  name: token.name,
                                  isActive: token.isActive,
                                })
                              }
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              {t("mcp.edit")}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={isBusy || demoMode}
                              onClick={() => {
                                void handleToggleToken(token);
                              }}
                            >
                              {isBusy ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : token.isActive ? (
                                <ShieldOff className="h-3.5 w-3.5" />
                              ) : (
                                <ShieldCheck className="h-3.5 w-3.5" />
                              )}
                              {token.isActive
                                ? t("mcp.revoke")
                                : t("mcp.reactivate")}
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={isBusy || demoMode}
                              onClick={() => setDeletingToken(token)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              {t("mcp.delete")}
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="rounded-[6px] border-2 border-border">
          <DialogHeader>
            <DialogTitle>{t("mcp.createTitle")}</DialogTitle>
            <DialogDescription>
              {t("mcp.createDesc")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mcp-token-name">{t("mcp.tokenName")}</Label>
              <Input
                id="mcp-token-name"
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder={t("mcp.cursorWorkspace")}
                disabled={creating}
                maxLength={120}
              />
            </div>

            <div className="rounded-[4px] border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              {t("mcp.bestPracticeTip")}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              {t("mcp.cancel")}
            </Button>
            <Button
              onClick={() => void handleCreateToken()}
              disabled={creating}
            >
              {creating ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("mcp.creating")}
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5" />
                  {t("mcp.createToken")}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editing}
        onOpenChange={(open) => !open && setEditing(null)}
      >
        <DialogContent className="rounded-[6px] border-2 border-border">
          <DialogHeader>
            <DialogTitle>{t("mcp.editTitle")}</DialogTitle>
            <DialogDescription>
              {t("mcp.editDesc")}
            </DialogDescription>
          </DialogHeader>

          {editing ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="mcp-token-edit-name">{t("mcp.tokenName")}</Label>
                <Input
                  id="mcp-token-edit-name"
                  value={editing.name}
                  onChange={(event) =>
                    setEditing((current) =>
                      current
                        ? { ...current, name: event.target.value }
                        : current,
                    )
                  }
                  disabled={savingTokenId === editing.id}
                  maxLength={120}
                />
              </div>

              <div className="flex items-center justify-between rounded-[4px] border border-border bg-muted/20 px-3 py-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    {t("mcp.allowAuth")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("mcp.allowAuthDesc")}
                  </p>
                </div>
                <Switch
                  checked={editing.isActive}
                  onCheckedChange={(checked) =>
                    setEditing((current) =>
                      current ? { ...current, isActive: checked } : current,
                    )
                  }
                  disabled={savingTokenId === editing.id}
                />
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditing(null)}
              disabled={!!editing && savingTokenId === editing.id}
            >
              {t("mcp.cancel")}
            </Button>
            <Button
              onClick={() => void handleSaveEdit()}
              disabled={!editing || savingTokenId === editing.id}
            >
              {editing && savingTokenId === editing.id ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("mcp.saving")}
                </>
              ) : (
                t("mcp.saveChanges")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deletingToken}
        onOpenChange={(open) => !open && setDeletingToken(null)}
      >
        <AlertDialogContent className="rounded-[6px] border-2 border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("mcp.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingToken
                ? t("mcp.deleteDesc", { name: deletingToken.name })
                : t("mcp.deleteDescGeneral")}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <Alert variant="destructive" className="border-destructive/40">
            <ShieldAlert className="h-4 w-4" />
            <AlertDescription>
              {t("mcp.deleteWarning")}
            </AlertDescription>
          </Alert>

          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={!!deletingToken && savingTokenId === deletingToken.id}
            >
              {t("mcp.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!!deletingToken && savingTokenId === deletingToken.id}
              onClick={() => {
                void handleDeleteToken();
              }}
            >
              {!!deletingToken && savingTokenId === deletingToken.id ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("mcp.saving")}
                </>
              ) : (
                t("mcp.delete")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
