"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Archive,
  BookOpen,
  Check,
  ChevronRight,
  FileSearch,
  Loader2,
  Pencil,
  RotateCcw,
  Undo2,
} from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components";
import { DetailBackButton } from "@/components/detail-back-button";
import { useEntityDocumentTitle } from "@/components/document-title-updater";
import {
  MICRO_LABEL,
  SchemeChip,
  TermKindBadge,
  TermLink,
  TermStatusBadge,
  useTermHref,
} from "@/components/glossary/glossary-ui";
import { TermEditorDialog } from "@/components/glossary/term-editor-dialog";
import {
  FindInTextDialog,
  TermBindings,
  TermEvidence,
  TermRelations,
} from "@/components/glossary/term-sections";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import {
  approveTerm,
  deprecateTerm,
  getTerm,
  getTermActivity,
  reinstateTerm,
  semanticErrorMessage,
  unapproveTerm,
  type TermActivity,
  type TermDetail,
} from "@/lib/semantic-api";
import { useStaticRouteParam } from "@/lib/use-route-id";

function Labels({ term }: { term: TermDetail }) {
  const { t } = useTranslation();
  const groups: Array<[TranslationKey, string[], string]> = [
    ["glossary.term.aliases" as TranslationKey, term.aliases, ""],
    ["glossary.term.codes" as TranslationKey, term.codes, "font-mono"],
    ["glossary.term.hiddenAliases" as TranslationKey, term.hiddenAliases, ""],
    ["glossary.term.proposedAliases" as TranslationKey, term.proposedAliases, ""],
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {groups
        .filter(([, values]) => values.length > 0)
        .map(([label, values, className]) => (
          <div key={label}>
            <div className={MICRO_LABEL}>{t(label)}</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {values.map((value) => (
                <Badge
                  key={value}
                  variant="outline"
                  className={`rounded-[4px] text-[11px] ${className}`}
                >
                  {value}
                </Badge>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}

function Activity({ termKey }: { termKey: string }) {
  const { t } = useTranslation();
  const [rows, setRows] = React.useState<TermActivity[] | null>(null);
  React.useEffect(() => {
    getTermActivity(termKey)
      .then((result) => setRows(result.activities))
      .catch(() => setRows([]));
  }, [termKey]);
  if (rows === null) {
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  }
  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("glossary.term.noActivity")}</p>;
  }
  return (
    <ol className="space-y-2">
      {rows.map((row) => (
        <li key={row.id} className="flex items-baseline gap-3 text-sm">
          <span className="w-40 shrink-0 font-mono text-[11px] text-muted-foreground">
            {new Date(row.createdAt).toLocaleString()}
          </span>
          <span className="font-mono text-[11px] uppercase">{row.type}</span>
          <span className="text-xs text-muted-foreground">{row.actor ?? ""}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * One term (SL1 R9, SL3 R7.3): what it is, where it sits in its scheme, what
 * binds data to it, and which documents are evidence of it.
 */
export default function GlossaryTermPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const termHref = useTermHref();
  const key = useStaticRouteParam("key");
  const [term, setTerm] = React.useState<TermDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [refresh, setRefresh] = React.useState(0);
  const [editing, setEditing] = React.useState(false);
  const [findInText, setFindInText] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  useEntityDocumentTitle(term?.term ?? null);

  React.useEffect(() => {
    if (!key) return;
    let active = true;
    getTerm(key)
      .then((result) => {
        if (!active) return;
        setTerm(result);
        setError(null);
        // An old key redirects to the current one.
        if (result.key !== key.toLowerCase()) {
          router.replace(termHref(result.key));
        }
      })
      .catch((loadError) => {
        if (active) setError(semanticErrorMessage(loadError, t("glossary.term.notFound")));
      });
    return () => {
      active = false;
    };
  }, [key, refresh, router, termHref, t]);

  async function transition(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await action();
      toast.success(done);
      setRefresh((value) => value + 1);
    } catch (actionError) {
      toast.error(semanticErrorMessage(actionError, t("glossary.actionFailed")));
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="space-y-4">
        <DetailBackButton fallbackHref="/glossary" />
        <EmptyState icon={BookOpen} title={t("glossary.term.notFound")} description={error} />
      </div>
    );
  }
  if (!term) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DetailBackButton fallbackHref="/glossary" />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          {term.broaderChain[0]?.length ? (
            <nav aria-label={t("glossary.term.broaderPath")} className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              {[...term.broaderChain[0]].reverse().map((entry) => (
                <React.Fragment key={entry.id}>
                  <TermLink termKey={entry.key} className="font-normal">
                    {entry.term}
                  </TermLink>
                  <ChevronRight className="h-3 w-3" />
                </React.Fragment>
              ))}
            </nav>
          ) : null}
          <h1 className="font-serif text-3xl font-black tracking-[0.02em]">{term.term}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <TermKindBadge kind={term.kind} />
            <TermStatusBadge status={term.status} />
            {term.kind === "ENTITY" && (
              <Badge variant="outline" className="rounded-[4px] text-[10px]">
                {t(`glossary.entityTypes.${term.entityType}` as TranslationKey)}
              </Badge>
            )}
            <SchemeChip scheme={term.scheme} />
            <span className="font-mono text-[11px] text-muted-foreground">{term.key}</span>
            {term.packKey && (
              <span className="text-[11px] text-muted-foreground">
                {t("glossary.schemes.fromPack", { pack: term.packKey })}
              </span>
            )}
          </div>
          {term.replacedBy && (
            <p className="text-sm">
              {t("glossary.term.replacedBy")}{" "}
              <TermLink termKey={term.replacedBy.key}>{term.replacedBy.term}</TermLink>
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {term.status === "DRAFT" && (
            <Button
              disabled={busy}
              onClick={() => transition(() => approveTerm(term.id), t("glossary.approved"))}
            >
              <Check className="h-4 w-4" />
              {t("glossary.approve")}
            </Button>
          )}
          {term.status === "APPROVED" && (
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => transition(() => unapproveTerm(term.id), t("glossary.term.unapproved"))}
                className="rounded-[4px] border-2 border-border"
              >
                <Undo2 className="h-4 w-4" />
                {t("glossary.term.unapprove")}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => transition(() => deprecateTerm(term.id), t("glossary.term.deprecated"))}
                className="rounded-[4px] border-2 border-border"
              >
                <Archive className="h-4 w-4" />
                {t("glossary.term.deprecate")}
              </Button>
            </>
          )}
          {term.status === "DEPRECATED" && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => transition(() => reinstateTerm(term.id), t("glossary.term.reinstated"))}
              className="rounded-[4px] border-2 border-border"
            >
              <RotateCcw className="h-4 w-4" />
              {t("glossary.term.reinstate")}
            </Button>
          )}
          {term.kind === "CONCEPT" && (
            <Button
              variant="outline"
              onClick={() => setFindInText(true)}
              className="rounded-[4px] border-2 border-border"
            >
              <FileSearch className="h-4 w-4" />
              {t("glossary.findInText.open")}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => setEditing(true)}
            className="rounded-[4px] border-2 border-border"
          >
            <Pencil className="h-4 w-4" />
            {t("glossary.edit")}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t("glossary.term.tabs.overview")}</TabsTrigger>
          <TabsTrigger value="evidence">{t("glossary.term.tabs.evidence")}</TabsTrigger>
          <TabsTrigger value="bindings">{t("glossary.term.tabs.bindings")}</TabsTrigger>
          <TabsTrigger value="activity">{t("glossary.term.tabs.activity")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 pt-4">
          <section className="space-y-2">
            <div className={MICRO_LABEL}>{t("glossary.editor.definitionLabel")}</div>
            <p className="max-w-3xl text-sm">
              {term.definition ?? (
                <span className="text-muted-foreground">{t("glossary.term.noDefinition")}</span>
              )}
            </p>
            {term.notes && <p className="max-w-3xl text-xs text-muted-foreground">{term.notes}</p>}
            {term.steward && (
              <p className="text-xs text-muted-foreground">
                {t("glossary.term.steward", { steward: term.steward })}
              </p>
            )}
          </section>
          <Labels term={term} />
          {term.narrower.length > 0 && (
            <section className="space-y-2">
              <div className={MICRO_LABEL}>{t("glossary.term.narrower")}</div>
              <div className="flex flex-wrap gap-2">
                {term.narrower.map((entry) => (
                  <TermLink
                    key={entry.id}
                    termKey={entry.key}
                    className="rounded-[4px] border border-border px-2 py-0.5 text-xs font-normal"
                  >
                    {entry.term}
                  </TermLink>
                ))}
              </div>
            </section>
          )}
          <section className="space-y-2">
            <div className={MICRO_LABEL}>{t("glossary.term.relations")}</div>
            <TermRelations term={term} onChanged={() => setRefresh((value) => value + 1)} />
          </section>
          {term.generatedDetectors.length > 0 && (
            <section className="space-y-1">
              <div className={MICRO_LABEL}>{t("glossary.term.generatedDetectors")}</div>
              <p className="text-xs">
                {term.generatedDetectors.map((detector) => detector.name).join(", ")}
              </p>
            </section>
          )}
        </TabsContent>

        <TabsContent value="evidence" className="pt-4">
          <TermEvidence term={term} />
        </TabsContent>
        <TabsContent value="bindings" className="pt-4">
          <TermBindings term={term} />
        </TabsContent>
        <TabsContent value="activity" className="pt-4">
          <Activity termKey={term.key} />
        </TabsContent>
      </Tabs>

      <TermEditorDialog
        open={editing}
        onOpenChange={setEditing}
        term={term}
        onSaved={(saved) => {
          toast.success(t("glossary.saved"));
          if (saved.key !== term.key) router.replace(termHref(saved.key));
          else setRefresh((value) => value + 1);
        }}
      />
      <FindInTextDialog term={term} open={findInText} onOpenChange={setFindInText} />
    </div>
  );
}
