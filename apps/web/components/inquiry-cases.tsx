"use client";

import * as React from "react";
import { FolderOpen, Loader2, Plus, Unlink, X } from "lucide-react";
import { toast } from "sonner";
import { api, type CaseResponseDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { CaseStatusBadge } from "@/components/case-status-badge";
import { CaseSearchList } from "@/components/case-target/case-search-list";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";
import { useNsPath } from "@/lib/ns-path";
import { useTranslation } from "@/hooks/use-translation";

/** A case as a watch knows it. */
export interface CaseRef {
  id: string;
  title: string;
  status: string;
}

type LiveProps = {
  /** An existing watch: linking and unlinking apply at once. */
  mode: "live";
  inquiryId: string;
  initial: CaseRef[];
  readOnly?: boolean;
  /** The cases after a change (the page can refresh what depends on them). */
  onChanged?: (cases: CaseRef[]) => void;
};

type DraftProps = {
  /** A watch not created yet: the cases to link once it is. */
  mode: "draft";
  value: CaseRef[];
  onChange: (next: CaseRef[]) => void;
};

/**
 * The cases a watch drives, and the way to change that from the watch's own
 * pages: link it to another open case, or unlink it from one (the case keeps
 * what it already pulled). Case titles open the case board at this watch.
 */
export function InquiryCasesPanel(props: LiveProps | DraftProps) {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  const live = props.mode === "live";
  const [cases, setCases] = React.useState<CaseRef[]>(live ? props.initial : props.value);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [unlinking, setUnlinking] = React.useState<CaseRef | null>(null);
  const shown = live ? cases : props.value;
  const inquiryId = live ? props.inquiryId : null;
  const readOnly = live ? !!props.readOnly : false;

  // A live watch re-reads its cases after each change: the server is the record.
  React.useEffect(() => {
    if (live) setCases(props.initial);
    // Only a new starting list resets it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live ? props.initial : null]);

  const refresh = async () => {
    if (!inquiryId || !live) return;
    const fresh = await api.inquiries.inquiriesControllerFindOne({ id: inquiryId });
    setCases(fresh.cases);
    props.onChanged?.(fresh.cases);
  };

  const link = async (c: CaseResponseDto) => {
    setPickerOpen(false);
    const ref: CaseRef = { id: c.id, title: c.title, status: c.status };
    if (!live) {
      if (!props.value.some((x) => x.id === c.id)) props.onChange([...props.value, ref]);
      return;
    }
    setBusy(c.id);
    try {
      await api.cases.casesControllerLinkInquiries({ id: c.id, linkInquiriesDto: { inquiryIds: [inquiryId!] } });
      toast.success(t("inquiryCases.linked", { title: c.title }));
      await refresh();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("investigations.caseDetail.failedToLinkInquiry")));
    } finally {
      setBusy(null);
    }
  };

  const unlink = async (c: CaseRef) => {
    if (!live) {
      props.onChange(props.value.filter((x) => x.id !== c.id));
      return;
    }
    setBusy(c.id);
    try {
      await api.cases.casesControllerUnlinkInquiry({ id: c.id, inquiryId: inquiryId! });
      toast.success(t("inquiryCases.unlinked", { title: c.title }));
      await refresh();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("investigations.caseDetail.failedToUnlinkInquiry")));
    } finally {
      setBusy(null);
    }
  };

  const caseHref = (c: CaseRef) =>
    nsPath(inquiryId ? `/investigations/${c.id}?panel=watches&watch=${inquiryId}` : `/investigations/${c.id}`);

  return (
    <div className="space-y-2" data-testid="inquiry-cases">
      {shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">{live ? t("inquiryCases.none") : t("inquiryCases.noneYet")}</p>
      ) : (
        <ul className="space-y-1.5">
          {shown.map((c) => (
            <li key={c.id} className="flex items-center gap-2 rounded-[4px] border border-border px-3 py-2" data-testid="inquiry-case">
              <FolderOpen className="text-muted-foreground h-3.5 w-3.5 shrink-0" aria-hidden />
              <a
                href={caseHref(c)}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                title={t("inquiryCases.open", { title: c.title })}
              >
                {c.title}
              </a>
              <CaseStatusBadge status={c.status as never} />
              {!readOnly && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-muted-foreground h-7 w-7"
                  disabled={busy === c.id}
                  aria-label={live ? t("inquiryCases.unlink") : t("inquiryCases.remove")}
                  title={live ? t("inquiryCases.unlink") : t("inquiryCases.remove")}
                  onClick={() => (live ? setUnlinking(c) : void unlink(c))}
                  data-testid="inquiry-case-unlink"
                >
                  {busy === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : live ? <Unlink className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1.5" data-testid="inquiry-case-link">
              {busy && !shown.some((c) => c.id === busy) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {t("inquiryCases.link")}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-2">
            {/* Mounted on open, so the list is read fresh every time. */}
            {pickerOpen && (
              <CaseSearchList
                autoFocus
                selectedId={null}
                excludeIds={new Set(shown.map((c) => c.id))}
                onSelect={(c) => void link(c)}
              />
            )}
          </PopoverContent>
        </Popover>
      )}

      <AlertDialog open={!!unlinking} onOpenChange={(open) => !open && setUnlinking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("inquiryCases.unlinkTitle", { title: unlinking?.title ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("investigations.caseDetail.unlinkInquiryDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const c = unlinking;
                setUnlinking(null);
                if (c) void unlink(c);
              }}
            >
              <Unlink className="h-3.5 w-3.5" /> {t("investigations.caseDetail.unlink")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * The cases a watch drives, as small links (a table cell): every name, up to
 * `max`, then how many more.
 */
export function CaseLinks({
  cases,
  max = 3,
  onOpen,
}: {
  cases: CaseRef[];
  max?: number;
  onOpen: (caseId: string) => void;
}) {
  const { t } = useTranslation();
  if (cases.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  const shown = cases.slice(0, max);
  return (
    <span className="flex max-w-[280px] flex-wrap gap-1">
      {shown.map((c) => {
        const closed = c.status === "CLOSED" || c.status === "ARCHIVED";
        return (
          <button
            key={c.id}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(c.id);
            }}
            className={`inline-flex max-w-full items-center gap-1 rounded-[3px] border border-border bg-card px-1.5 py-0.5 text-left text-[11px] hover:border-foreground/40 ${closed ? "text-muted-foreground" : ""}`}
            title={`${c.title} · ${c.status.replace("_", " ").toLowerCase()}`}
            data-testid="inquiry-case-chip"
          >
            <FolderOpen className="h-3 w-3 shrink-0" aria-hidden />
            <span className={`truncate ${closed ? "line-through" : ""}`}>{c.title}</span>
          </button>
        );
      })}
      {cases.length > max && (
        <span className="px-1 py-0.5 text-[11px] text-muted-foreground" title={cases.slice(max).map((c) => c.title).join(", ")}>
          {t("inquiryCases.more", { count: cases.length - max })}
        </span>
      )}
    </span>
  );
}
