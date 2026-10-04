"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  BookOpen,
  Download,
  Loader2,
  Package,
  Plus,
  Upload,
} from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import {
  exportGlossaryUrl,
  importGlossary,
  installPack,
  listPacks,
  proposalCounts,
  semanticErrorMessage,
  type ImportReport,
  type Term,
  type TermKind,
} from "@/lib/semantic-api";
import { EntityLabelsCard } from "./entity-sections";
import { MICRO_LABEL } from "./glossary-ui";
import { ProposalsPanel } from "./proposals-panel";
import { SchemesPanel } from "./schemes-panel";
import { TermEditorDialog } from "./term-editor-dialog";
import { TermsPanel } from "./terms-panel";
import { VocabularyPanel } from "./vocabulary-panel";

type Tab = "concepts" | "entities" | "schemes" | "vocabulary" | "proposals";
const TABS: Tab[] = [
  "concepts",
  "entities",
  "schemes",
  "vocabulary",
  "proposals",
];

function PacksDialog({
  open,
  onOpenChange,
  onInstalled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstalled: () => void;
}) {
  const { t } = useTranslation();
  const [packs, setPacks] = React.useState<Awaited<
    ReturnType<typeof listPacks>
  > | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [dryRun, setDryRun] = React.useState<{
    key: string;
    counts: Record<string, number>;
    bindings: Record<string, number>;
  } | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setDryRun(null);
    listPacks()
      .then(setPacks)
      .catch(() => setPacks({ installed: [], available: [] }));
  }, [open]);

  async function preview(key: string) {
    setBusy(key);
    try {
      const result = await installPack(key, true);
      setDryRun({
        key,
        counts: result.terms.counts,
        bindings: result.bindings.counts,
      });
    } catch (error) {
      toast.error(semanticErrorMessage(error, t("glossary.packs.failed")));
    } finally {
      setBusy(null);
    }
  }

  async function install(key: string) {
    setBusy(key);
    try {
      await installPack(key, false);
      toast.success(t("glossary.packs.installed"));
      onInstalled();
      onOpenChange(false);
    } catch (error) {
      toast.error(semanticErrorMessage(error, t("glossary.packs.failed")));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("glossary.packs.title")}</DialogTitle>
          <DialogDescription>
            {t("glossary.packs.description")}
          </DialogDescription>
        </DialogHeader>
        {packs === null ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <ul className="space-y-2">
            {packs.available.map((pack) => (
              <li
                key={pack.key}
                className="space-y-2 rounded-[4px] border-2 border-border px-4 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{pack.name}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        v{pack.version}
                      </span>
                      {pack.installedVersion && (
                        <Badge
                          variant="outline"
                          className="rounded-[4px] text-[10px]"
                        >
                          {t("glossary.packs.installedVersion", {
                            version: pack.installedVersion,
                          })}
                        </Badge>
                      )}
                    </div>
                    {pack.description && (
                      <p className="text-xs text-muted-foreground">
                        {pack.description}
                      </p>
                    )}
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {t("glossary.packs.counts", {
                        schemes: String(pack.counts.schemes ?? 0),
                        terms: String(pack.counts.terms ?? 0),
                        bindings: String(pack.counts.bindings ?? 0),
                      })}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => preview(pack.key)}
                      className="h-8 rounded-[4px] border-2 border-border text-xs"
                    >
                      {t("glossary.packs.preview")}
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => install(pack.key)}
                      className="h-8 rounded-[4px] text-xs"
                    >
                      {busy === pack.key && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      )}
                      {pack.installedVersion
                        ? t("glossary.packs.reinstall")
                        : t("glossary.packs.install")}
                    </Button>
                  </div>
                </div>
                {dryRun?.key === pack.key && (
                  <p className="rounded-[4px] bg-muted/50 px-3 py-2 text-xs">
                    {t("glossary.packs.dryRun", {
                      create: String(dryRun.counts.create ?? 0),
                      update: String(dryRun.counts.update ?? 0),
                      skip: String(dryRun.counts.skip ?? 0),
                      bindings: String(
                        Object.values(dryRun.bindings).reduce(
                          (a, b) => a + b,
                          0,
                        ),
                      ),
                    })}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const { t } = useTranslation();
  const [format, setFormat] = React.useState<"csv" | "skos">("csv");
  const [content, setContent] = React.useState("");
  const [asDraft, setAsDraft] = React.useState(false);
  const [conflict, setConflict] = React.useState<
    "skip" | "overwrite" | "merge-labels"
  >("skip");
  const [report, setReport] = React.useState<ImportReport | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setContent("");
    setReport(null);
  }, [open]);

  async function run(dryRun: boolean) {
    setBusy(true);
    try {
      const result = await importGlossary({
        format,
        content,
        dryRun,
        conflict,
        asDraft,
      });
      setReport(result);
      if (!dryRun) {
        toast.success(t("glossary.import.done"));
        onImported();
        onOpenChange(false);
      }
    } catch (error) {
      toast.error(semanticErrorMessage(error, t("glossary.import.failed")));
    } finally {
      setBusy(false);
    }
  }

  async function readFile(file: File) {
    setContent(await file.text());
    if (file.name.endsWith(".json") || file.name.endsWith(".jsonld"))
      setFormat("skos");
    if (file.name.endsWith(".csv")) setFormat("csv");
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("glossary.import.title")}</DialogTitle>
          <DialogDescription>
            {t("glossary.import.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={format}
              onValueChange={(value) => setFormat(value as "csv" | "skos")}
            >
              <SelectTrigger className="h-9 w-[160px] rounded-[4px] border-2 border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="csv">CSV</SelectItem>
                <SelectItem value="skos">SKOS (JSON-LD)</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={conflict}
              onValueChange={(value) =>
                setConflict(value as "skip" | "overwrite" | "merge-labels")
              }
            >
              <SelectTrigger className="h-9 w-[220px] rounded-[4px] border-2 border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="skip">
                  {t("glossary.import.conflictSkip")}
                </SelectItem>
                <SelectItem value="merge-labels">
                  {t("glossary.import.conflictMerge")}
                </SelectItem>
                <SelectItem value="overwrite">
                  {t("glossary.import.conflictOverwrite")}
                </SelectItem>
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={asDraft} onCheckedChange={setAsDraft} />
              {t("glossary.import.asDraft")}
            </label>
          </div>
          <input
            type="file"
            accept=".csv,.json,.jsonld"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void readFile(file);
            }}
            className="text-xs"
          />
          <Textarea
            value={content}
            rows={8}
            onChange={(event) => setContent(event.target.value)}
            placeholder={t("glossary.import.placeholder")}
            className="font-mono text-xs"
          />
          {report && (
            <div className="rounded-[4px] bg-muted/50 px-3 py-2 text-xs">
              <div className={MICRO_LABEL}>{t("glossary.import.report")}</div>
              <p>
                {t("glossary.import.counts", {
                  create: String(report.counts.create),
                  update: String(report.counts.update),
                  skip: String(report.counts.skip),
                  conflict: String(report.counts.conflict),
                  refused: String(report.counts.refused),
                })}
              </p>
              {report.items
                .filter((item) => item.reason)
                .slice(0, 8)
                .map((item) => (
                  <p
                    key={`${item.row}-${item.key}`}
                    className="text-muted-foreground"
                  >
                    {item.term}: {item.reason}
                  </p>
                ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant="outline"
            disabled={busy || !content.trim()}
            onClick={() => run(true)}
          >
            {t("glossary.import.dryRun")}
          </Button>
          <Button disabled={busy || !content.trim()} onClick={() => run(false)}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t("glossary.import.run")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The glossary (SL1–SL4): concepts and entities, schemes, the vocabulary the
 * data actually produces, and the review queue — one workspace.
 */
export function GlossaryWorkspace({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  // Other pages link straight to a tab: an entity's candidates to the review
  // queue (?tab=proposals), the Entities switch to its list (?tab=entities).
  const searchParams = useSearchParams();
  const [tab, setTab] = React.useState<Tab>(() => {
    const wanted = searchParams?.get("tab");
    return TABS.includes(wanted as Tab) ? (wanted as Tab) : "concepts";
  });
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [editing, setEditing] = React.useState<Term | null>(null);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [packsOpen, setPacksOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [pending, setPending] = React.useState(0);

  const bump = React.useCallback(() => setRefreshKey((value) => value + 1), []);

  React.useEffect(() => {
    proposalCounts()
      .then((counts) =>
        setPending(
          Object.values(counts).reduce((sum, n) => sum + (Number(n) || 0), 0),
        ),
      )
      .catch(() => setPending(0));
  }, [refreshKey]);

  const defaultKind: TermKind = tab === "entities" ? "ENTITY" : "CONCEPT";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {!embedded ? (
          <div className="flex items-center gap-3">
            <BookOpen className="size-7" />
            <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
              {t("glossary.title")}
            </h1>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("glossary.description")}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setPacksOpen(true)}
            className="rounded-[4px] border-2 border-border"
          >
            <Package className="h-4 w-4" />
            {t("glossary.packs.open")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="rounded-[4px] border-2 border-border"
              >
                <Download className="h-4 w-4" />
                {t("glossary.transfer")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <a href={exportGlossaryUrl("csv")} download>
                  {t("glossary.export.csv")}
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={exportGlossaryUrl("skos")} download>
                  {t("glossary.export.skos")}
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setImportOpen(true)}>
                <Upload className="h-3.5 w-3.5" />
                {t("glossary.import.title")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            {t("glossary.addTerm")}
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
        <TabsList>
          <TabsTrigger value="concepts">
            {t("glossary.tabs.concepts")}
          </TabsTrigger>
          <TabsTrigger value="entities">
            {t("glossary.tabs.entities")}
          </TabsTrigger>
          <TabsTrigger value="schemes">
            {t("glossary.tabs.schemes")}
          </TabsTrigger>
          <TabsTrigger value="vocabulary">
            {t("glossary.tabs.vocabulary")}
          </TabsTrigger>
          <TabsTrigger value="proposals">
            {t("glossary.tabs.proposals")}
            {pending > 0 && (
              <span className="ml-1.5 rounded-full bg-accent px-1.5 font-mono text-[10px] text-accent-foreground">
                {pending}
              </span>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="concepts" className="pt-4">
          <TermsPanel
            kind="CONCEPT"
            refreshKey={refreshKey}
            onEdit={(term) => {
              setEditing(term);
              setEditorOpen(true);
            }}
            onChanged={bump}
          />
        </TabsContent>
        <TabsContent value="entities" className="space-y-4 pt-4">
          <EntityLabelsCard onSaved={bump} />
          <TermsPanel
            kind="ENTITY"
            refreshKey={refreshKey}
            onEdit={(term) => {
              setEditing(term);
              setEditorOpen(true);
            }}
            onChanged={bump}
          />
        </TabsContent>
        <TabsContent value="schemes" className="pt-4">
          <SchemesPanel refreshKey={refreshKey} onChanged={bump} />
        </TabsContent>
        <TabsContent value="vocabulary" className="pt-4">
          <VocabularyPanel refreshKey={refreshKey} onChanged={bump} />
        </TabsContent>
        <TabsContent value="proposals" className="pt-4">
          <ProposalsPanel refreshKey={refreshKey} onChanged={bump} />
        </TabsContent>
      </Tabs>

      <TermEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        term={editing}
        defaultKind={defaultKind}
        onSaved={() => {
          toast.success(t("glossary.saved"));
          bump();
        }}
      />
      <PacksDialog
        open={packsOpen}
        onOpenChange={setPacksOpen}
        onInstalled={bump}
      />
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={bump}
      />
    </div>
  );
}
