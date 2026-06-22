"use client";

import * as React from "react";
import {
  api,
  type McpServerResponseDto,
  type CreateMcpServerDtoTransportEnum,
  type CreateMcpServerDtoAgentKindsEnum,
} from "@workspace/api-client";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import {
  Loader2,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Trash2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { kindLabelKey } from "./harness-kind";

const MISSION_KINDS = [
  "INQUIRY",
  "CASE",
  "CONFIG",
  "DETECTOR_AUTHOR",
  "DREAM",
] as const;

type FormState = {
  id?: string;
  name: string;
  transport: "http" | "stdio";
  url: string;
  command: string;
  argsText: string;
  headersText: string;
  allowlistText: string;
  enabled: boolean;
  trusted: boolean;
  agentKinds: string[];
};

const EMPTY_FORM: FormState = {
  name: "",
  transport: "http",
  url: "",
  command: "",
  argsText: "",
  headersText: "",
  allowlistText: "",
  enabled: true,
  trusted: false,
  agentKinds: [],
};

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** External MCP server management: connect, scope to missions, trust, test. */
export function HarnessMcp() {
  const { t } = useTranslation();
  const [servers, setServers] = React.useState<McpServerResponseDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = React.useState(false);
  const [testingId, setTestingId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setServers(await api.autopilot.mcpServersControllerList());
    } catch {
      // transient
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };
  const openEdit = (s: McpServerResponseDto) => {
    setForm({
      id: s.id,
      name: s.name,
      transport: s.transport === "stdio" ? "stdio" : "http",
      url: s.url ?? "",
      command: s.command ?? "",
      argsText: s.args.join("\n"),
      headersText: "",
      allowlistText: s.toolAllowlist.join("\n"),
      enabled: s.enabled,
      trusted: s.trusted,
      agentKinds: s.agentKinds,
    });
    setDialogOpen(true);
  };

  const save = async () => {
    try {
      setSaving(true);
      const headers = form.headersText.trim()
        ? Object.fromEntries(
            lines(form.headersText).map((line) => {
              const idx = line.indexOf(":");
              return idx === -1
                ? [line, ""]
                : [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
            }),
          )
        : undefined;
      const base = {
        name: form.name,
        transport: form.transport as CreateMcpServerDtoTransportEnum,
        url: form.transport === "http" ? form.url : undefined,
        command: form.transport === "stdio" ? form.command : undefined,
        args: lines(form.argsText),
        toolAllowlist: lines(form.allowlistText),
        enabled: form.enabled,
        trusted: form.trusted,
        agentKinds: form.agentKinds as CreateMcpServerDtoAgentKindsEnum[],
        ...(headers ? { headers } : {}),
      };
      if (form.id) {
        await api.autopilot.mcpServersControllerUpdate({
          id: form.id,
          updateMcpServerDto: base,
        });
        toast.success(t("harness.mcp.updated"));
      } else {
        await api.autopilot.mcpServersControllerCreate({
          createMcpServerDto: base,
        });
        toast.success(t("harness.mcp.created"));
      }
      setDialogOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("settings.failedToSave"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm(t("harness.mcp.confirmDelete"))) return;
    try {
      await api.autopilot.mcpServersControllerRemove({ id });
      toast.success(t("harness.mcp.deleted"));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("settings.failedToSave"));
    }
  };

  const test = async (id: string) => {
    try {
      setTestingId(id);
      const res = await api.autopilot.mcpServersControllerTest({ id });
      if (res.ok) toast.success(t("harness.mcp.testOk", { count: res.tools.length }));
      else toast.error(`${t("harness.mcp.testFail")}: ${res.error ?? ""}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("harness.mcp.testFail"));
    } finally {
      setTestingId(null);
    }
  };

  const refreshAll = async () => {
    try {
      setRefreshing(true);
      setServers(await api.autopilot.mcpServersControllerRefresh());
      toast.success(t("harness.mcp.refreshed"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("settings.failedToSave"));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-3 rounded-[4px] border-2 border-border bg-muted/10 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Plug className="h-4 w-4 text-[#d97706]" />
        <div className="mr-auto">
          <p className="text-sm font-medium">{t("harness.mcp.title")}</p>
          <p className="text-xs text-muted-foreground">{t("harness.mcp.desc")}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refreshAll()}
          disabled={refreshing}
        >
          {refreshing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {t("harness.mcp.refresh")}
        </Button>
        <Button size="sm" onClick={openAdd}>
          <Plus className="h-3.5 w-3.5" />
          {t("harness.mcp.add")}
        </Button>
      </div>

      {loading ? (
        <div className="text-muted-foreground flex items-center gap-2 py-4 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : servers.length === 0 ? (
        <p className="rounded-[4px] border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
          {t("harness.mcp.noneDesc")}
        </p>
      ) : (
        <ul className="space-y-2">
          {servers.map((s) => (
            <li
              key={s.id}
              className="rounded-[4px] border-2 border-border bg-card px-3 py-2.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    s.lastError
                      ? "bg-red-500"
                      : s.enabled
                        ? "bg-emerald-500"
                        : "bg-stone-400",
                  )}
                />
                <span className="text-sm font-medium">{s.name}</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {s.transport} · {s.slug}
                </span>
                {s.trusted && (
                  <Badge variant="outline" className="border-[#d97706]/50 text-[#d97706] text-[9px] uppercase">
                    {t("harness.mcp.trusted")}
                  </Badge>
                )}
                <Badge variant="outline" className="font-mono text-[9px]">
                  {t("harness.mcp.tools", { count: s.discoveredTools.length })}
                </Badge>
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void test(s.id)}
                    disabled={testingId === s.id}
                  >
                    {testingId === s.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Zap className="h-3.5 w-3.5" />
                    )}
                    {t("harness.mcp.test")}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(s)} aria-label={t("harness.mcp.editTitle")}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void remove(s.id)}
                    aria-label={t("harness.mcp.confirmDelete")}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-red-600" />
                  </Button>
                </div>
              </div>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                {s.agentKinds.length === 0
                  ? t("harness.mcp.agentsAll")
                  : s.agentKinds
                      .map((k) => t(kindLabelKey(k)))
                      .join(", ")}
              </p>
              {s.lastError && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                  {s.lastError}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <McpDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        form={form}
        setForm={setForm}
        onSave={save}
        saving={saving}
      />
    </div>
  );
}

function McpDialog({
  open,
  onOpenChange,
  form,
  setForm,
  onSave,
  saving,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  onSave: () => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const toggleKind = (kind: string) =>
    setForm((f) => ({
      ...f,
      agentKinds: f.agentKinds.includes(kind)
        ? f.agentKinds.filter((k) => k !== kind)
        : [...f.agentKinds, kind],
    }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-[6px] border-2 border-border sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plug className="h-4 w-4 text-[#d97706]" />
            {form.id ? t("harness.mcp.editTitle") : t("harness.mcp.addTitle")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label={t("harness.mcp.name")}>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="h-9 rounded-[4px] border-2 border-border"
            />
          </Field>
          <Field label={t("harness.mcp.transport")}>
            <Select
              value={form.transport}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, transport: v as "http" | "stdio" }))
              }
            >
              <SelectTrigger className="h-9 rounded-[4px] border-2 border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="http">{t("harness.mcp.http")}</SelectItem>
                <SelectItem value="stdio">{t("harness.mcp.stdio")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {form.transport === "http" ? (
            <>
              <Field label={t("harness.mcp.url")}>
                <Input
                  value={form.url}
                  onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                  placeholder="https://example.com/mcp"
                  className="h-9 rounded-[4px] border-2 border-border font-mono text-xs"
                />
              </Field>
              <Field label={t("harness.mcp.headers")}>
                <Textarea
                  value={form.headersText}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, headersText: e.target.value }))
                  }
                  rows={2}
                  placeholder="Authorization: Bearer …"
                  className="rounded-[4px] border-2 border-border font-mono text-xs"
                />
              </Field>
            </>
          ) : (
            <>
              <Field label={t("harness.mcp.command")}>
                <Input
                  value={form.command}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, command: e.target.value }))
                  }
                  placeholder="npx"
                  className="h-9 rounded-[4px] border-2 border-border font-mono text-xs"
                />
              </Field>
              <Field label={t("harness.mcp.args")}>
                <Textarea
                  value={form.argsText}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, argsText: e.target.value }))
                  }
                  rows={2}
                  className="rounded-[4px] border-2 border-border font-mono text-xs"
                />
              </Field>
            </>
          )}

          <Field label={t("harness.mcp.agents")}>
            <div className="flex flex-wrap gap-1.5">
              {MISSION_KINDS.map((kind) => {
                const on = form.agentKinds.includes(kind);
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => toggleKind(kind)}
                    className={cn(
                      "rounded-[3px] border-2 px-2 py-1 font-mono text-[10px] uppercase tracking-wide transition-colors",
                      on
                        ? "border-[#d97706] bg-[#d97706]/10 text-foreground"
                        : "border-border text-muted-foreground hover:border-foreground/40",
                    )}
                  >
                    {t(kindLabelKey(kind))}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {form.agentKinds.length === 0 ? t("harness.mcp.agentsAll") : ""}
            </p>
          </Field>

          <Field label={t("harness.mcp.allowlist")}>
            <Textarea
              value={form.allowlistText}
              onChange={(e) =>
                setForm((f) => ({ ...f, allowlistText: e.target.value }))
              }
              rows={2}
              className="rounded-[4px] border-2 border-border font-mono text-xs"
            />
          </Field>

          <div className="flex items-center justify-between gap-4 rounded-[4px] border-2 border-border px-3 py-2">
            <div>
              <p className="text-sm font-medium">{t("harness.mcp.trusted")}</p>
              <p className="text-xs text-muted-foreground">
                {t("harness.mcp.trustedDesc")}
              </p>
            </div>
            <Switch
              checked={form.trusted}
              onCheckedChange={(v) => setForm((f) => ({ ...f, trusted: v }))}
            />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-[4px] border-2 border-border px-3 py-2">
            <p className="text-sm font-medium">{t("harness.mcp.enabled")}</p>
            <Switch
              checked={form.enabled}
              onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("harness.mcp.cancel")}
            </Button>
            <Button onClick={onSave} disabled={saving || !form.name.trim()}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {t("harness.mcp.save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="font-mono text-[11px] uppercase tracking-[0.12em]">
        {label}
      </Label>
      {children}
    </div>
  );
}
