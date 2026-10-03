"use client";

import * as React from "react";
import { toast } from "sonner";
import { Link2, Loader2, Plus, Shapes, X } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import {
  getAssetMeaning,
  getFindingMeaning,
  linkTerm,
  listVocabulary,
  semanticErrorMessage,
  unlinkTerm,
  type AssetMeaningTerm,
  type FindingMeaning,
  type LookupHit,
  type VocabularyRow,
} from "@/lib/semantic-api";
import { BindDialog } from "./bind-dialog";
import {
  MICRO_LABEL,
  MethodBadge,
  SchemeChip,
  TermLink,
  TermPicker,
  TermStatusBadge,
} from "./glossary-ui";

/** Say by hand that a finding, asset or case is about a term (SL3 R5). */
function ManualLink({
  target,
  onLinked,
}: {
  target: { type: "finding" | "asset" | "case"; id: string };
  onLinked: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const [term, setTerm] = React.useState<LookupHit | null>(null);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function save() {
    if (!term) return;
    setBusy(true);
    try {
      await linkTerm({ termId: term.id, target, note: note.trim() || undefined });
      toast.success(t("glossary.meaning.linked"));
      setOpen(false);
      setTerm(null);
      setNote("");
      onLinked();
    } catch (error) {
      toast.error(semanticErrorMessage(error, t("glossary.actionFailed")));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="h-8 rounded-[4px] border-2 border-border text-xs"
      >
        <Plus className="h-3.5 w-3.5" />
        {t("glossary.meaning.linkByHand")}
      </Button>
    );
  }
  return (
    <div className="space-y-2 rounded-[4px] border-2 border-dashed border-border p-3">
      <TermPicker value={term} onChange={setTerm} autoFocus />
      <Input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder={t("glossary.meaning.notePlaceholder")}
        className="h-8 rounded-[4px] border-2 border-border text-xs"
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" onClick={save} disabled={!term || busy}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t("glossary.meaning.link")}
        </Button>
      </div>
    </div>
  );
}

/**
 * *Meaning* on the finding page (SL3 R7.1): which concepts this finding is
 * evidence of, through which binding or manual link, and what that implies
 * further up the taxonomy. Opens *What does this mean?* for its output.
 */
export function FindingMeaningCard({ findingId }: { findingId: string }) {
  const { t } = useTranslation();
  const [data, setData] = React.useState<FindingMeaning | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [refresh, setRefresh] = React.useState(0);
  const [row, setRow] = React.useState<VocabularyRow | null>(null);
  const [binding, setBinding] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    getFindingMeaning(findingId)
      .then((result) => {
        if (active) setData(result);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [findingId, refresh]);

  async function openBind() {
    if (!data) return;
    const output = data.output;
    const result = await listVocabulary({
      kind: "outputs",
      bound: "any",
      q: output.findingType,
      take: 50,
    }).catch(() => null);
    const match =
      result?.rows.find(
        (candidate) =>
          candidate.output?.detectorType === output.detectorType &&
          candidate.output?.findingType === output.findingType &&
          (candidate.output?.customDetectorKey ?? null) ===
            (output.customDetectorKey ?? null),
      ) ?? null;
    setRow(
      match ?? {
        kind: "output",
        id: `${output.detectorType}|${output.customDetectorKey ?? ""}|${output.findingType}`,
        output: { ...output, pipelineType: null },
        label: output.label,
        sources: [],
        openCount: 0,
        assetCount: 0,
        distinctValues: null,
        categorical: false,
        topValues: [],
        lastSeenAt: null,
        refreshedAt: null,
        bindings: [],
        bound: false,
      },
    );
    setBinding(true);
  }

  if (failed) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Shapes className="h-4 w-4" />
          {t("glossary.meaning.title")}
        </CardTitle>
        <CardDescription>
          {data ? `${data.output.label.label} · ${data.output.label.detail}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {data === null ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : data.meanings.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("glossary.meaning.none")}</p>
        ) : (
          <ul className="space-y-2">
            {data.meanings.map((item, index) => (
              <li
                key={`${item.term.id}-${item.method}-${index}`}
                className="flex items-start justify-between gap-2"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <TermLink termKey={item.term.key}>{item.term.name}</TermLink>
                    <MethodBadge method={item.method} />
                    {item.term.status !== "APPROVED" && (
                      <TermStatusBadge status={item.term.status} />
                    )}
                    <SchemeChip scheme={item.term.scheme} />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {item.method === "BROADER" && item.via
                      ? t("glossary.meaning.impliedBy", { term: item.via.name })
                      : item.binding
                        ? t("glossary.meaning.throughBinding", {
                            label: item.binding.label,
                          })
                        : item.linkedBy
                          ? t("glossary.meaning.linkedBy", {
                              by: item.linkedBy.by ?? "—",
                            })
                          : ""}
                  </p>
                </div>
                {item.linkedBy && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t("glossary.meaning.unlink")}
                    onClick={async () => {
                      try {
                        await unlinkTerm(item.linkedBy!.referenceId);
                        setRefresh((value) => value + 1);
                      } catch (error) {
                        toast.error(semanticErrorMessage(error, t("glossary.actionFailed")));
                      }
                    }}
                    className="h-7"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void openBind()}
            disabled={!data}
            className="h-8 rounded-[4px] border-2 border-border text-xs"
          >
            <Link2 className="h-3.5 w-3.5" />
            {t("glossary.meaning.whatDoesThisMean")}
          </Button>
          <ManualLink
            target={{ type: "finding", id: findingId }}
            onLinked={() => setRefresh((value) => value + 1)}
          />
        </div>
      </CardContent>
      <BindDialog
        open={binding}
        onOpenChange={setBinding}
        row={row}
        onSaved={() => setRefresh((value) => value + 1)}
      />
    </Card>
  );
}

function AssetTermRow({ entry }: { entry: AssetMeaningTerm }) {
  const { t } = useTranslation();
  return (
    <li className={entry.current ? "space-y-1" : "space-y-1 opacity-60"}>
      <div className="flex flex-wrap items-center gap-2">
        <TermLink termKey={entry.term.key}>{entry.term.name}</TermLink>
        {entry.methods.map((method) => (
          <MethodBadge key={method.method} method={method.method} />
        ))}
        <SchemeChip scheme={entry.term.scheme} />
      </div>
      <p className="text-[11px] text-muted-foreground">
        {entry.current
          ? t("glossary.meaning.support", {
              count: entry.methods
                .reduce((sum, method) => sum + method.support, 0)
                .toLocaleString(),
            })
          : t("glossary.meaning.gone")}
        {entry.methods
          .flatMap((method) => method.bindings)
          .slice(0, 2)
          .map((binding) => ` · ${binding.label}`)
          .join("")}
      </p>
    </li>
  );
}

/** *Meaning* on the asset page (SL3 R7.2): the asset's concepts, by method. */
export function AssetMeaningCard({ assetId }: { assetId: string }) {
  const { t } = useTranslation();
  const [data, setData] = React.useState<Awaited<
    ReturnType<typeof getAssetMeaning>
  > | null>(null);
  const [history, setHistory] = React.useState(false);
  const [refresh, setRefresh] = React.useState(0);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    getAssetMeaning(assetId, history)
      .then((result) => {
        if (active) setData(result);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [assetId, history, refresh]);

  if (failed) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Shapes className="h-4 w-4" />
          {t("glossary.meaning.title")}
        </CardTitle>
        <CardDescription>{t("glossary.meaning.assetHint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {data === null ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : data.current.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("glossary.meaning.noneAsset")}</p>
        ) : (
          <ul className="space-y-2">
            {data.current.map((entry) => (
              <AssetTermRow key={entry.term.id} entry={entry} />
            ))}
          </ul>
        )}
        {history && data && data.history.length > 0 && (
          <div className="space-y-1">
            <div className={MICRO_LABEL}>{t("glossary.meaning.history")}</div>
            <ul className="space-y-2">
              {data.history.map((entry) => (
                <AssetTermRow key={`h-${entry.term.id}`} entry={entry} />
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <ManualLink
            target={{ type: "asset", id: assetId }}
            onLinked={() => setRefresh((value) => value + 1)}
          />
          <button
            type="button"
            onClick={() => setHistory((value) => !value)}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {history ? t("glossary.meaning.hideHistory") : t("glossary.meaning.showHistory")}
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
