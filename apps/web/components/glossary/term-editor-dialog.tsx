"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import {
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
  Textarea,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import {
  listSchemes,
  saveTerm,
  semanticErrorMessage,
  type EntityType,
  type Scheme,
  type Term,
  type TermKind,
} from "@/lib/semantic-api";
import { splitList } from "./glossary-ui";

const ENTITY_TYPES: EntityType[] = [
  "PERSON",
  "ORGANIZATION",
  "LOCATION",
  "REFERENCE",
  "TERM",
  "OTHER",
];

const NO_SCHEME = "__none__";

type FormState = {
  kind: TermKind;
  term: string;
  key: string;
  definition: string;
  schemeId: string;
  aliases: string;
  codes: string;
  hiddenAliases: string;
  entityType: EntityType;
  steward: string;
  notes: string;
};

function formOf(term: Term | null, kind: TermKind): FormState {
  return {
    kind: term?.kind ?? kind,
    term: term?.term ?? "",
    key: term?.key ?? "",
    definition: term?.definition ?? "",
    schemeId: term?.schemeId ?? NO_SCHEME,
    aliases: (term?.aliases ?? []).join(", "),
    codes: (term?.codes ?? []).join(", "),
    hiddenAliases: (term?.hiddenAliases ?? []).join(", "),
    entityType: term?.entityType ?? (kind === "CONCEPT" ? "TERM" : "ORGANIZATION"),
    steward: term?.steward ?? "",
    notes: term?.notes ?? "",
  };
}

/**
 * Add or edit a term (SL1 R8): concepts get a definition, a scheme, codes and
 * hidden aliases; entities get an entity type. Single letters go to hidden
 * aliases — they would otherwise match every document.
 */
export function TermEditorDialog({
  open,
  onOpenChange,
  term,
  defaultKind = "CONCEPT",
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  term: Term | null;
  defaultKind?: TermKind;
  onSaved: (term: Term) => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = React.useState<FormState>(() =>
    formOf(term, defaultKind),
  );
  const [schemes, setSchemes] = React.useState<Scheme[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setForm(formOf(term, defaultKind));
    setError(null);
    listSchemes()
      .then(setSchemes)
      .catch(() => setSchemes([]));
  }, [open, term, defaultKind]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const singleLetterAliases = splitList(form.aliases).filter(
    (alias) => alias.length === 1,
  );

  async function save() {
    if (!form.term.trim()) {
      setError(t("glossary.termRequired"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await saveTerm({
        id: term?.id,
        term: form.term.trim(),
        kind: form.kind,
        key: term && form.key.trim() !== term.key ? form.key.trim() : undefined,
        definition: form.definition.trim() || null,
        schemeId:
          form.kind === "CONCEPT" && form.schemeId !== NO_SCHEME
            ? form.schemeId
            : null,
        aliases: splitList(form.aliases),
        codes: splitList(form.codes),
        hiddenAliases: splitList(form.hiddenAliases),
        entityType: form.entityType,
        steward: form.steward.trim() || null,
        notes: form.notes.trim() || null,
      });
      onSaved(saved);
      onOpenChange(false);
    } catch (saveError) {
      setError(semanticErrorMessage(saveError, t("glossary.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {term ? t("glossary.editTerm") : t("glossary.addTerm")}
          </DialogTitle>
          <DialogDescription>
            {form.kind === "CONCEPT"
              ? t("glossary.editor.conceptHint")
              : t("glossary.editor.entityHint")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-2" role="radiogroup">
            {(["CONCEPT", "ENTITY"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={form.kind === kind}
                onClick={() => set("kind", kind)}
                className={
                  form.kind === kind
                    ? "rounded-[4px] border-2 border-accent bg-accent/10 px-3 py-2 text-left"
                    : "rounded-[4px] border-2 border-border px-3 py-2 text-left hover:bg-muted"
                }
              >
                <div className="text-sm font-semibold">
                  {t(`glossary.kinds.${kind}` as TranslationKey)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t(`glossary.editor.kindHelp.${kind}` as TranslationKey)}
                </div>
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="term-name">{t("glossary.form.termLabel")}</Label>
            <Input
              id="term-name"
              value={form.term}
              autoFocus
              onChange={(event) => set("term", event.target.value)}
              placeholder={
                form.kind === "CONCEPT"
                  ? t("glossary.editor.conceptPlaceholder")
                  : t("glossary.form.termPlaceholder")
              }
            />
          </div>

          {term && (
            <div className="space-y-1.5">
              <Label htmlFor="term-key">{t("glossary.editor.keyLabel")}</Label>
              <Input
                id="term-key"
                value={form.key}
                onChange={(event) => set("key", event.target.value)}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                {t("glossary.editor.keyHelp")}
              </p>
            </div>
          )}

          {form.kind === "CONCEPT" ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="term-definition">
                  {t("glossary.editor.definitionLabel")}
                </Label>
                <Textarea
                  id="term-definition"
                  value={form.definition}
                  rows={3}
                  onChange={(event) => set("definition", event.target.value)}
                  placeholder={t("glossary.editor.definitionPlaceholder")}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("glossary.editor.schemeLabel")}</Label>
                <Select
                  value={form.schemeId}
                  onValueChange={(value) => set("schemeId", value)}
                >
                  <SelectTrigger className="w-full rounded-[4px] border-2 border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_SCHEME}>
                      {t("glossary.editor.noScheme")}
                    </SelectItem>
                    {schemes.map((scheme) => (
                      <SelectItem key={scheme.id} value={scheme.id}>
                        {scheme.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              <Label>{t("glossary.form.entityTypeLabel")}</Label>
              <Select
                value={form.entityType}
                onValueChange={(value) => set("entityType", value as EntityType)}
              >
                <SelectTrigger className="w-full rounded-[4px] border-2 border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(`glossary.entityTypes.${type}` as TranslationKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="term-aliases">{t("glossary.form.aliasesLabel")}</Label>
            <Input
              id="term-aliases"
              value={form.aliases}
              onChange={(event) => set("aliases", event.target.value)}
              placeholder={t("glossary.form.aliasesPlaceholder")}
            />
            {singleLetterAliases.length > 0 ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {t("glossary.editor.singleLetterWarning", {
                  letters: singleLetterAliases.join(", "),
                })}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t("glossary.form.aliasesHelp")}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="term-codes">{t("glossary.editor.codesLabel")}</Label>
              <Input
                id="term-codes"
                value={form.codes}
                onChange={(event) => set("codes", event.target.value)}
                placeholder="GES, AG"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                {t("glossary.editor.codesHelp")}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="term-hidden">
                {t("glossary.editor.hiddenAliasesLabel")}
              </Label>
              <Input
                id="term-hidden"
                value={form.hiddenAliases}
                onChange={(event) => set("hiddenAliases", event.target.value)}
                placeholder="E"
              />
              <p className="text-xs text-muted-foreground">
                {t("glossary.editor.hiddenAliasesHelp")}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="term-steward">
                {t("glossary.editor.stewardLabel")}
              </Label>
              <Input
                id="term-steward"
                value={form.steward}
                onChange={(event) => set("steward", event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="term-notes">{t("glossary.form.notesLabel")}</Label>
            <Textarea
              id="term-notes"
              value={form.notes}
              rows={2}
              onChange={(event) => set("notes", event.target.value)}
              placeholder={t("glossary.form.notesPlaceholder")}
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t("common.cancel")}
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {saving ? t("glossary.saving") : t("glossary.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
