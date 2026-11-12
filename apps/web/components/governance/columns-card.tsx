"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Pencil, ShieldAlert, Star } from "lucide-react";
import {
  api,
  type UpdateAssetColumnDtoClassificationEnum,
} from "@workspace/api-client";
import {
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  ToneBadge,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  type StatusTone,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";
import type { LookupHit } from "@/lib/semantic-api";
import { TermPicker } from "@/components/glossary/glossary-ui";
import {
  CLASSIFICATIONS,
  type AssetColumnDto,
  type AssetColumnsDto,
} from "@/lib/governance";

const CLASSIFICATION_TONE: Record<string, StatusTone> = {
  public: "neutral",
  internal: "idle",
  confidential: "changed",
  personal: "progress",
  sensitive: "error",
  secret: "error",
};
const DERIVED = "__derived__";

/** A column's classification: who said it, and whether a steward confirmed it. */
export function ClassificationChip({ column }: { column: AssetColumnDto }) {
  const { t } = useTranslation();
  const value = column.effectiveClassification;
  if (!value) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const hint =
    column.findings.length > 0
      ? column.findings
          .map(
            (group) =>
              `${group.findingType} × ${group.count} (${group.maxSeverity})`,
          )
          .join(", ")
      : t("governance.columns.setBySteward");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1">
          <ToneBadge tone={CLASSIFICATION_TONE[value] ?? "neutral"}>
            {t(`governance.classification.${value}` as TranslationKey)}
          </ToneBadge>
          {column.reviewedAt ? (
            <CheckCircle2
              className="h-3.5 w-3.5 text-accent-ink"
              aria-label={t("governance.columns.reviewed")}
            />
          ) : column.derivedClassification ? (
            <ShieldAlert
              className="h-3.5 w-3.5 text-amber-600"
              aria-label={t("governance.columns.toReview")}
            />
          ) : null}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        {column.classification
          ? t("governance.columns.override")
          : t("governance.columns.derived")}
        {": "}
        {hint}
      </TooltipContent>
    </Tooltip>
  );
}

function ColumnDialog({
  assetId,
  column,
  onClose,
  onSaved,
}: {
  assetId: string;
  column: AssetColumnDto;
  onClose: () => void;
  onSaved: (next: AssetColumnsDto) => void;
}) {
  const { t } = useTranslation();
  const [businessName, setBusinessName] = useState(column.businessName ?? "");
  const [description, setDescription] = useState(column.description ?? "");
  const [term, setTerm] = useState<LookupHit | null>(
    column.term
      ? ({
          id: column.term.id,
          key: column.term.key,
          term: column.term.term,
          status: column.term.status,
        } as LookupHit)
      : null,
  );
  const [cde, setCde] = useState(column.criticalDataElement);
  const [classification, setClassification] = useState<string>(
    column.classification ?? DERIVED,
  );
  const [busy, setBusy] = useState(false);

  const save = async (reviewClassification: boolean) => {
    setBusy(true);
    try {
      onSaved(
        await api.governance.governanceControllerUpdateColumn({
          id: assetId,
          name: column.name,
          updateAssetColumnDto: {
            businessName: businessName.trim() || null,
            description: description.trim() || null,
            termId: term?.id ?? null,
            criticalDataElement: cde,
            classification:
              classification === DERIVED
                ? null
                : (classification as UpdateAssetColumnDtoClassificationEnum),
            ...(reviewClassification ? { reviewClassification: true } : {}),
          },
        }),
      );
      toast.success(t("governance.saved"));
      onClose();
    } catch (error) {
      toast.error(
        await extractApiErrorMessage(error, t("governance.saveFailed")),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono">{column.name}</DialogTitle>
          <DialogDescription>
            {column.type || t("governance.columns.noType")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="col-business">
              {t("governance.columns.businessName")}
            </Label>
            <Input
              id="col-business"
              value={businessName}
              onChange={(event) => setBusinessName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="col-description">
              {t("governance.fields.description")}
            </Label>
            <Textarea
              id="col-description"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("governance.columns.term")}</Label>
            <TermPicker value={term} onChange={setTerm} kind="CONCEPT" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label htmlFor="col-cde">{t("governance.columns.cde")}</Label>
              <p className="text-xs text-muted-foreground">
                {t("governance.columns.cdeHint")}
              </p>
            </div>
            <Switch id="col-cde" checked={cde} onCheckedChange={setCde} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="col-classification">
              {t("governance.columns.classification")}
            </Label>
            <Select value={classification} onValueChange={setClassification}>
              <SelectTrigger id="col-classification">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DERIVED}>
                  {column.derivedClassification
                    ? t("governance.columns.useDerived", {
                        value: t(
                          `governance.classification.${column.derivedClassification}` as TranslationKey,
                        ),
                      })
                    : t("governance.columns.none")}
                </SelectItem>
                {CLASSIFICATIONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`governance.classification.${value}` as TranslationKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {column.findings.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t("governance.columns.findings", {
                  list: column.findings
                    .map((group) => `${group.findingType} × ${group.count}`)
                    .join(", "),
                })}
              </p>
            )}
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          {column.derivedClassification && !column.reviewedAt && (
            <Button
              variant="outline"
              onClick={() => void save(true)}
              disabled={busy}
              data-testid="column-save-review"
            >
              {t("governance.columns.saveAndConfirm")}
            </Button>
          )}
          <Button
            onClick={() => void save(false)}
            disabled={busy}
            data-testid="column-save"
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The columns of a table as a steward sees them (GOV §5.7): business name,
 * meaning, critical data elements, and the classification open findings give
 * each column, to confirm or override.
 */
export function ColumnsCard({
  assetId,
  state,
  onChange,
}: {
  assetId: string;
  state: AssetColumnsDto;
  onChange: (next: AssetColumnsDto) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<AssetColumnDto | null>(null);
  const [moveTo, setMoveTo] = useState<Record<string, string>>({});

  const confirm = async (column: AssetColumnDto) => {
    try {
      onChange(
        await api.governance.governanceControllerUpdateColumn({
          id: assetId,
          name: column.name,
          updateAssetColumnDto: { reviewClassification: true },
        }),
      );
    } catch (error) {
      toast.error(
        await extractApiErrorMessage(error, t("governance.saveFailed")),
      );
    }
  };

  const move = async (column: AssetColumnDto) => {
    const to = moveTo[column.name];
    if (!to) return;
    try {
      onChange(
        await api.governance.governanceControllerMoveColumn({
          id: assetId,
          name: column.name,
          moveAssetColumnDto: { to },
        }),
      );
    } catch (error) {
      toast.error(
        await extractApiErrorMessage(error, t("governance.saveFailed")),
      );
    }
  };

  const forget = async (column: AssetColumnDto) => {
    try {
      onChange(
        await api.governance.governanceControllerRemoveColumn({
          id: assetId,
          name: column.name,
        }),
      );
    } catch (error) {
      toast.error(
        await extractApiErrorMessage(error, t("governance.saveFailed")),
      );
    }
  };

  const toReview = state.columns.filter(
    (column) => column.derivedClassification && !column.reviewedAt,
  ).length;
  const free = state.columns.filter(
    (column) =>
      !column.businessName &&
      !column.description &&
      !column.term &&
      !column.classification &&
      !column.reviewedAt &&
      !column.criticalDataElement,
  );

  return (
    <Card data-testid="columns-card">
      <CardHeader>
        <CardTitle>{t("governance.columns.title")}</CardTitle>
        <CardDescription>
          {t("governance.columns.description", {
            count: state.columns.length,
          })}
          {toReview > 0 &&
            ` ${t("governance.columns.toReviewCount", { count: toReview })}`}
          {state.findingsWithoutColumn > 0 &&
            ` ${t("governance.columns.loose", { count: state.findingsWithoutColumn })}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("governance.columns.column")}</TableHead>
                <TableHead>{t("governance.columns.businessName")}</TableHead>
                <TableHead>{t("governance.columns.term")}</TableHead>
                <TableHead>{t("governance.columns.classification")}</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.columns.map((column) => (
                <TableRow key={column.name} data-testid="column-row">
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      {column.criticalDataElement && (
                        <Star
                          className="h-3.5 w-3.5 fill-current text-amber-500"
                          aria-label={t("governance.columns.cde")}
                        />
                      )}
                      <span className="font-mono text-sm">{column.name}</span>
                    </div>
                    {column.type && (
                      <Badge
                        variant="outline"
                        className="mt-1 font-mono text-[10px]"
                      >
                        {column.type}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[260px]">
                    <div className="text-sm">{column.businessName ?? "—"}</div>
                    {column.description && (
                      <div className="line-clamp-2 text-xs text-muted-foreground">
                        {column.description}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {column.term?.term ?? "—"}
                  </TableCell>
                  <TableCell>
                    <ClassificationChip column={column} />
                  </TableCell>
                  <TableCell className="text-right">
                    {state.canGovern && (
                      <span className="inline-flex gap-1">
                        {column.derivedClassification && !column.reviewedAt && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void confirm(column)}
                            data-testid="column-confirm"
                          >
                            {t("governance.columns.confirm")}
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          aria-label={t("governance.columns.edit", {
                            name: column.name,
                          })}
                          onClick={() => setEditing(column)}
                          data-testid="column-edit"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {state.removed.length > 0 && (
          <div className="space-y-2 rounded-md border border-dashed p-3">
            <div className="text-sm font-semibold">
              {t("governance.columns.removedTitle")}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("governance.columns.removedHint")}
            </p>
            {state.removed.map((column) => (
              <div
                key={column.name}
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <span className="font-mono">{column.name}</span>
                {column.businessName && (
                  <span className="text-muted-foreground">
                    {column.businessName}
                  </span>
                )}
                {state.canGovern && (
                  <>
                    <Select
                      value={moveTo[column.name] ?? ""}
                      onValueChange={(value) =>
                        setMoveTo({ ...moveTo, [column.name]: value })
                      }
                    >
                      <SelectTrigger className="h-8 w-44">
                        <SelectValue
                          placeholder={t("governance.columns.moveTo")}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {free.map((target) => (
                          <SelectItem key={target.name} value={target.name}>
                            {target.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!moveTo[column.name]}
                      onClick={() => void move(column)}
                    >
                      {t("governance.columns.move")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void forget(column)}
                    >
                      {t("governance.columns.forget")}
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
      {editing && (
        <ColumnDialog
          assetId={assetId}
          column={editing}
          onClose={() => setEditing(null)}
          onSaved={onChange}
        />
      )}
    </Card>
  );
}
