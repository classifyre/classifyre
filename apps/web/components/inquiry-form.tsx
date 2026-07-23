"use client";

import { nsPath } from "@/lib/ns-path";
import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Check, Database, Filter, Eye, Sparkles, Fingerprint, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type InquiryResponseDto,
  type MatchOptionsResponseDto,
  type PreviewResponseDto,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Textarea } from "@workspace/ui/components/textarea";
import { Label } from "@workspace/ui/components/label";
import { SeverityBadge } from "@workspace/ui/components/severity-badge";
import { ScrollArea } from "@workspace/ui/components/scroll-area";

const DETECTORS = ["SECRETS", "PII", "YARA", "BROKEN_LINKS", "CODE_SECURITY", "CUSTOM"] as const;
const parseList = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
const joinList = (items: string[]) => items.join(", ");

const STEPS = [
  { id: "define", label: "Define", icon: Sparkles },
  { id: "filters", label: "Filters", icon: Filter },
  { id: "preview", label: "Preview", icon: Eye },
] as const;
type StepId = (typeof STEPS)[number]["id"];

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex items-center gap-1 rounded-[4px] border-2 px-2.5 py-1 text-xs font-medium transition-all ${
        active
          ? "border-border bg-foreground text-background shadow-[2px_2px_0_var(--color-border)]"
          : "border-border text-muted-foreground hover:bg-accent"
      }`}>
      {active && <Check className="h-3 w-3" />}
      {children}
    </button>
  );
}

function SectionHeading({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-3 border-b-2 border-border pb-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-border font-mono text-xs font-bold">{n}</span>
      <h2 className="font-serif text-xl font-black uppercase tracking-[0.05em]">{title}</h2>
    </div>
  );
}

function applyInitialFindingTypes(
  findingTypes: string[],
  options: MatchOptionsResponseDto | null,
): { selectedTypes: Set<string>; customTypeText: string } {
  if (!options) {
    return { selectedTypes: new Set(findingTypes), customTypeText: "" };
  }
  const known = new Set(options.findingTypes.map((t) => t.value));
  const selected = findingTypes.filter((t) => known.has(t));
  const custom = findingTypes.filter((t) => !known.has(t));
  return {
    selectedTypes: new Set(selected),
    customTypeText: joinList(custom),
  };
}

export type InquiryFormProps = {
  mode: "create" | "edit";
  inquiryId?: string;
  initial?: InquiryResponseDto;
};

export interface InquiryFormHandle {
  getValues: () => {
    title: string;
    description: string;
    matchers: {
      matchAllSources: boolean;
      sourceIds: string[];
      detectorTypes: string[];
      customDetectorKeys: string[];
      findingTypes: string[];
      findingTypeRegex: string[];
      findingValueRegex: string[];
    };
  };
  applyPatches: (patches: Array<{ path: string; value: unknown }>) => void;
}

export const InquiryForm = React.forwardRef<InquiryFormHandle, InquiryFormProps>(
  function InquiryForm({ mode, inquiryId, initial }, ref) {
  const router = useRouter();
  const isEdit = mode === "edit";

  const [title, setTitle] = React.useState(initial?.title ?? "");
  const [description, setDescription] = React.useState(initial?.description ?? "");
  const [matchAllSources, setMatchAllSources] = React.useState(initial?.matchAllSources ?? true);
  const [selectedSources, setSelectedSources] = React.useState<Set<string>>(
    () => new Set(initial?.sourceIds ?? []),
  );
  const [selectedDetectors, setSelectedDetectors] = React.useState<Set<string>>(
    () => new Set(initial?.detectorTypes ?? []),
  );
  const [selectedCustomKeys, setSelectedCustomKeys] = React.useState<Set<string>>(
    () => new Set(initial?.customDetectorKeys ?? []),
  );
  const [selectedTypes, setSelectedTypes] = React.useState<Set<string>>(
    () => new Set(initial?.findingTypes ?? []),
  );
  const [customTypeText, setCustomTypeText] = React.useState("");
  const [regexText, setRegexText] = React.useState(joinList(initial?.findingTypeRegex ?? []));
  const [valueRegexText, setValueRegexText] = React.useState(joinList(initial?.findingValueRegex ?? []));
  const [typeSearch, setTypeSearch] = React.useState("");

  const [options, setOptions] = React.useState<MatchOptionsResponseDto | null>(null);
  const [preview, setPreview] = React.useState<PreviewResponseDto | null>(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [activeStep, setActiveStep] = React.useState<StepId>("define");
  const findingTypesSplitRef = React.useRef(false);

  const sectionRefs = {
    define: React.useRef<HTMLElement>(null),
    filters: React.useRef<HTMLElement>(null),
    preview: React.useRef<HTMLElement>(null),
  };

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); setter(n);
  };

  const loadOptions = React.useCallback(async (sourceIds?: string[]) => {
    try {
      setOptions(await api.inquiries.inquiriesControllerMatchOptions({ sourceIds }));
    } catch (err) { console.error(err); }
  }, []);

  React.useEffect(() => { void loadOptions(); }, [loadOptions]);
  React.useEffect(() => {
    if (matchAllSources) void loadOptions();
    else if (selectedSources.size > 0) void loadOptions(Array.from(selectedSources));
  }, [matchAllSources, selectedSources, loadOptions]);

  React.useEffect(() => {
    if (!isEdit || !initial || !options || findingTypesSplitRef.current) return;
    const { selectedTypes: splitSelected, customTypeText: splitCustom } = applyInitialFindingTypes(
      initial.findingTypes,
      options,
    );
    setSelectedTypes(splitSelected);
    setCustomTypeText(splitCustom);
    findingTypesSplitRef.current = true;
  }, [isEdit, initial, options]);

  const matchers = React.useMemo(() => ({
    matchAllSources,
    sourceIds: matchAllSources ? [] : Array.from(selectedSources),
    detectorTypes: Array.from(selectedDetectors) as never,
    customDetectorKeys: Array.from(selectedCustomKeys),
    findingTypes: [...selectedTypes, ...parseList(customTypeText)],
    findingTypeRegex: parseList(regexText),
    findingValueRegex: parseList(valueRegexText),
  }), [matchAllSources, selectedSources, selectedDetectors, selectedCustomKeys, selectedTypes, customTypeText, regexText, valueRegexText]);

  React.useImperativeHandle(
    ref,
    () => ({
      getValues: () => ({ title, description, matchers }),
      applyPatches: (patches) => {
        for (const patch of patches) {
          if (patch.path === "title") {
            setTitle(String(patch.value ?? ""));
          } else if (patch.path === "description") {
            setDescription(String(patch.value ?? ""));
          } else if (patch.path === "matchers.matchAllSources") {
            setMatchAllSources(Boolean(patch.value));
          } else if (patch.path === "matchers.sourceIds") {
            setSelectedSources(new Set(Array.isArray(patch.value) ? patch.value.map(String) : []));
          } else if (patch.path === "matchers.detectorTypes") {
            setSelectedDetectors(new Set(Array.isArray(patch.value) ? patch.value.map(String) : []));
          } else if (patch.path === "matchers.customDetectorKeys") {
            setSelectedCustomKeys(new Set(Array.isArray(patch.value) ? patch.value.map(String) : []));
          } else if (patch.path === "matchers.findingTypes") {
            setSelectedTypes(new Set(Array.isArray(patch.value) ? patch.value.map(String) : []));
          } else if (patch.path === "matchers.findingTypeRegex") {
            setRegexText(joinList(Array.isArray(patch.value) ? patch.value.map(String) : []));
          } else if (patch.path === "matchers.findingValueRegex") {
            setValueRegexText(joinList(Array.isArray(patch.value) ? patch.value.map(String) : []));
          }
        }
      },
    }),
    [title, description, matchers],
  );

  const matchersKey = JSON.stringify(matchers);
  React.useEffect(() => {
    if (!matchAllSources && selectedSources.size === 0) { setPreview(null); return; }
    let cancelled = false;
    setPreviewing(true);
    const t = setTimeout(async () => {
      try {
        const res = await api.inquiries.inquiriesControllerPreview({ previewInquiryDto: matchers });
        if (!cancelled) setPreview(res);
      } catch (err) { if (!cancelled) console.error(err); }
      finally { if (!cancelled) setPreviewing(false); }
    }, 450);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchersKey]);

  React.useEffect(() => {
    const els = STEPS.map((s) => ({ id: s.id, el: sectionRefs[s.id].current })).filter((x): x is { id: StepId; el: HTMLElement } => !!x.el);
    const map = new Map<Element, StepId>(els.map(({ id, el }) => [el, id]));
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { const id = map.get(e.target); if (id) setActiveStep(id); }
    }, { rootMargin: "0px 0px -65% 0px", threshold: 0 });
    els.forEach(({ el }) => obs.observe(el));
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);

  const scrollTo = (id: StepId) => sectionRefs[id].current?.scrollIntoView({ behavior: "smooth", block: "start" });

  const save = async () => {
    if (!title.trim()) { toast.error("Give the inquiry a name"); scrollTo("define"); return; }
    setSaving(true);
    try {
      if (isEdit) {
        if (!inquiryId) throw new Error("Missing inquiry id");
        await api.inquiries.inquiriesControllerUpdate({
          id: inquiryId,
          updateInquiryDto: { title: title.trim(), description: description.trim() || undefined, ...matchers },
        });
        toast.success("Inquiry updated");
        router.push(nsPath(`/investigations/inquiries/${inquiryId}`));
      } else {
        const created = await api.inquiries.inquiriesControllerCreate({
          createInquiryDto: { title: title.trim(), description: description.trim() || undefined, ...matchers },
        });
        toast.success("Inquiry created");
        router.push(nsPath(`/investigations/inquiries/${created.id}`));
      }
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : isEdit ? "Failed to update inquiry" : "Failed to create inquiry");
    } finally { setSaving(false); }
  };

  const back = () => {
    if (isEdit && inquiryId) router.push(nsPath(`/investigations/inquiries/${inquiryId}`));
    else router.push(nsPath("/investigations"));
  };

  const filteredTypes = (options?.findingTypes ?? []).filter((t) =>
    !typeSearch.trim() || t.value.toLowerCase().includes(typeSearch.trim().toLowerCase()),
  );
  const noSourcesChosen = !matchAllSources && selectedSources.size === 0;

  return (
    <div className="container max-w-5xl py-8 space-y-6">
      <div>
        <Button variant="outline" onClick={back}
          className="mb-4 rounded-[4px] border-2 border-border shadow-[3px_3px_0_var(--color-border)]">
          <ArrowLeft className="mr-2 h-4 w-4" /> {isEdit ? "Back to inquiry" : "Investigations"}
        </Button>
        <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
          {isEdit ? "Edit inquiry" : "New inquiry"}
        </h1>
        <p className="text-muted-foreground mt-2 max-w-2xl">
          {isEdit
            ? "Update the saved query. Changing filters will recompute matches."
            : "An inquiry is a saved query. Findings that match it are tracked so you can pull them into a case. Tune the filters and preview what currently matches before saving."}
        </p>
      </div>

      <div className="flex gap-8 lg:gap-12">
        <div className="min-w-0 flex-1 space-y-12 pb-32">
          <section ref={sectionRefs.define} className="space-y-4">
            <SectionHeading n={1} title="Define the inquiry" />
            <div className="space-y-1.5">
              <Label htmlFor="q-title">Inquiry <span className="text-destructive">*</span></Label>
              <Input id="q-title" value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="Was sensitive data sent externally?" autoFocus className="text-base" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="q-desc">Description</Label>
              <Textarea id="q-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
                placeholder="What signal are you monitoring for?" />
            </div>
          </section>

          <section ref={sectionRefs.filters} className="space-y-6">
            <SectionHeading n={2} title="What should land here?" />

            <div className="space-y-2">
              <Label className="flex items-center gap-1.5"><Database className="h-3.5 w-3.5" /> Sources</Label>
              <div className="flex flex-wrap gap-1.5">
                <Chip active={matchAllSources} onClick={() => setMatchAllSources(true)}>All sources</Chip>
                <Chip active={!matchAllSources} onClick={() => setMatchAllSources(false)}>Specific</Chip>
              </div>
              {!matchAllSources && (
                <div className="flex flex-wrap gap-1.5 rounded-[4px] border border-border p-2 max-h-40 overflow-auto">
                  {(options?.sources ?? []).length === 0 && <span className="text-muted-foreground text-xs">No sources.</span>}
                  {(options?.sources ?? []).map((s) => (
                    <Chip key={s.id} active={selectedSources.has(s.id)} onClick={() => toggle(selectedSources, setSelectedSources, s.id)}>{s.name}</Chip>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Detector types <span className="text-muted-foreground font-normal">— empty = any</span></Label>
              <div className="flex flex-wrap gap-1.5">
                {DETECTORS.map((d) => (
                  <Chip key={d} active={selectedDetectors.has(d)} onClick={() => toggle(selectedDetectors, setSelectedDetectors, d)}>{d}</Chip>
                ))}
              </div>
            </div>

            {(options?.customDetectors ?? []).length > 0 && (
              <div className="space-y-2">
                <Label>Custom detectors</Label>
                <div className="flex flex-wrap gap-1.5">
                  {options!.customDetectors.map((c) => (
                    <Chip key={c.key} active={selectedCustomKeys.has(c.key)} onClick={() => toggle(selectedCustomKeys, setSelectedCustomKeys, c.key)}>{c.name}</Chip>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Finding types <span className="text-muted-foreground font-normal">— empty = any</span></Label>
              <Input value={typeSearch} onChange={(e) => setTypeSearch(e.target.value)} placeholder="Filter detected types…" className="h-8 max-w-xs" />
              {filteredTypes.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 rounded-[4px] border border-border p-2 max-h-44 overflow-auto">
                  {filteredTypes.map((t) => (
                    <Chip key={`${t.detectorType}:${t.value}`} active={selectedTypes.has(t.value)} onClick={() => toggle(selectedTypes, setSelectedTypes, t.value)}>
                      {t.value} <span className="opacity-50">· {t.count}</span>
                    </Chip>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-xs">No detected finding types{noSourcesChosen ? " — pick sources first" : " yet"}.</p>
              )}
              <Input value={customTypeText} onChange={(e) => setCustomTypeText(e.target.value)} placeholder="Add exact types not listed (comma-separated)" className="h-8" />
              <Input value={regexText} onChange={(e) => setRegexText(e.target.value)} placeholder="Type regex, e.g. ^entity:, ^classification: (comma-separated)" className="h-8 font-mono text-xs" />
            </div>

            <div className="space-y-2">
              <Label>Value filter <span className="text-muted-foreground font-normal">— match on detected content</span></Label>
              <p className="text-muted-foreground text-[11px]">
                Regex patterns tested against the matched value (e.g. a specific email domain, an IP prefix, a keyword). Empty = any value.
              </p>
              <Input value={valueRegexText} onChange={(e) => setValueRegexText(e.target.value)} placeholder="e.g. @acme\.com, ^192\.168\., password (comma-separated)" className="h-8 font-mono text-xs" />
            </div>
          </section>

          <section ref={sectionRefs.preview} className="space-y-3">
            <SectionHeading n={3} title="Preview matches" />
            {noSourcesChosen ? (
              <p className="text-muted-foreground text-sm">Choose “All sources” or pick specific sources to preview.</p>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <div className="flex items-baseline gap-2">
                    <span className="font-serif text-4xl font-black tabular-nums">{preview?.total ?? "—"}</span>
                    <span className="text-muted-foreground text-sm">findings match right now</span>
                  </div>
                  {previewing && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                </div>
                {preview && preview.sample.length > 0 && (
                  <ScrollArea className="h-72 rounded-[4px] border border-border">
                    <div className="divide-y divide-border/60">
                      {preview.sample.map((m) => (
                        <div key={m.findingId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <Fingerprint className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                            <span className="truncate font-medium">{m.label}</span>
                            {m.severity && <SeverityBadge severity={m.severity.toLowerCase() as never} className="shrink-0">{m.severity}</SeverityBadge>}
                            {m.matchedContent && <span className="text-muted-foreground truncate text-[11px]">{m.matchedContent.slice(0, 48)}</span>}
                          </span>
                          {m.assetName && <span className="text-muted-foreground shrink-0 truncate text-xs max-w-[40%]">{m.assetName}</span>}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
                {preview && preview.total > preview.sample.length && (
                  <p className="text-muted-foreground text-xs">Showing {preview.sample.length} of {preview.total}.</p>
                )}
              </>
            )}
          </section>
        </div>

        <aside className="hidden self-start md:sticky md:top-6 md:block md:w-48 space-y-4">
          <nav className="space-y-1">
            {STEPS.map((s) => {
              const Icon = s.icon;
              const active = activeStep === s.id;
              return (
                <button key={s.id} onClick={() => scrollTo(s.id)}
                  className={`flex w-full items-center gap-2.5 rounded-[4px] border-2 px-3 py-2 text-left text-sm transition-all ${
                    active ? "border-border bg-card shadow-[3px_3px_0_var(--color-border)] font-semibold" : "border-transparent text-muted-foreground hover:bg-accent"
                  }`}>
                  <Icon className="h-4 w-4 shrink-0" /> {s.label}
                </button>
              );
            })}
          </nav>
          <Button className="w-full rounded-[4px] border-2 border-border shadow-[3px_3px_0_var(--color-border)]"
            onClick={save} disabled={!title.trim() || saving}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {isEdit ? "Update inquiry" : "Create inquiry"}
          </Button>
          {preview && <p className="text-muted-foreground text-center text-[11px]">{preview.total} current match{preview.total === 1 ? "" : "es"}</p>}
        </aside>
      </div>
    </div>
  );
  },
);
