"use client";

import * as React from "react";
import { Filter, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@workspace/api-client";
import type {
  AssetRowsDto,
  GovernancePrincipalDto,
  RowConditionDto,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Input } from "@workspace/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Switch } from "@workspace/ui/components/switch";
import { useTranslation } from "@/hooks/use-translation";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";
import { EVERYONE, parseValues, valuesText } from "@/lib/row-filters";
import { PrincipalPicker } from "./principal-picker";

interface DraftCondition {
  column: string;
  op: "in" | "not_in";
  /** As typed: comma-separated. */
  values: string;
}

interface DraftRule {
  id?: string;
  /** `everyone`, or the group picked. */
  everyone: boolean;
  group: GovernancePrincipalDto | null;
  conditions: DraftCondition[];
}

function draftOf(rows: AssetRowsDto): DraftRule[] {
  return rows.rules.map((rule) => ({
    id: rule.id,
    everyone: rule.principalRef === EVERYONE,
    group: rule.principal ?? null,
    conditions: rule.conditions.map((condition: RowConditionDto) => ({
      column: condition.column,
      op: condition.op as DraftCondition["op"],
      values: valuesText(condition.values),
    })),
  }));
}

/**
 * Which rows of a table each reader sees (DQ §5.10), on its Governance tab.
 * Off: everyone who may query it sees every row. On: a reader sees the rows
 * a rule for them (or for everyone) selects, and none without one; the
 * owner and stewards see every row. Whoever governs may make it stricter;
 * only the owner or a steward may show readers more.
 */
export function RowsCard({
  assetId,
  columns,
}: {
  assetId: string;
  columns: string[];
}) {
  const { t } = useTranslation();
  const [rows, setRows] = React.useState<AssetRowsDto | null>(null);
  const [enabled, setEnabled] = React.useState(false);
  const [rules, setRules] = React.useState<DraftRule[]>([]);
  const [busy, setBusy] = React.useState(false);

  const apply = (next: AssetRowsDto) => {
    setRows(next);
    setEnabled(next.enabled);
    setRules(draftOf(next));
  };

  React.useEffect(() => {
    api.governance
      .governanceControllerAssetRows({ id: assetId })
      .then(apply)
      .catch(() => setRows(null));
  }, [assetId]);

  if (!rows) return null;

  const save = async () => {
    setBusy(true);
    try {
      apply(
        await api.governance.governanceControllerUpdateAssetRows({
          id: assetId,
          updateAssetRowsDto: {
            enabled,
            rules: rules
              .filter((rule) => rule.everyone || rule.group)
              .map((rule) => ({
                ...(rule.id ? { id: rule.id } : {}),
                principalRef: rule.everyone ? EVERYONE : rule.group!.ref,
                conditions: rule.conditions
                  .filter((c) => c.column && c.values.trim())
                  .map((c) => ({
                    column: c.column,
                    op: c.op,
                    values: parseValues(c.values),
                  })),
              })),
          },
        }),
      );
      toast.success(t("rowFilters.saved"));
    } catch (error) {
      toast.error(
        await extractApiErrorMessage(error, t("rowFilters.saveFailed")),
      );
    } finally {
      setBusy(false);
    }
  };

  const update = (index: number, change: Partial<DraftRule>) =>
    setRules((list) =>
      list.map((rule, i) => (i === index ? { ...rule, ...change } : rule)),
    );
  const updateCondition = (
    index: number,
    at: number,
    change: Partial<DraftCondition>,
  ) =>
    update(index, {
      conditions: rules[index]!.conditions.map((condition, i) =>
        i === at ? { ...condition, ...change } : condition,
      ),
    });

  return (
    <Card data-testid="governance-rows">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Filter className="h-4 w-4" />
          {t("rowFilters.title")}
        </CardTitle>
        <CardDescription>{t("rowFilters.lead")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!rows.canGovern ? (
          <p className="text-sm text-muted-foreground">
            {rows.enabled ? t("rowFilters.onReadOnly") : t("rowFilters.off")}
          </p>
        ) : (
          <>
            <label className="flex items-center gap-3 text-sm font-medium">
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                data-testid="rows-enabled"
              />
              {t("rowFilters.enabled")}
            </label>
            {!rows.readsEveryRow && (
              <p
                className="rounded-[4px] border border-dashed p-3 text-xs text-muted-foreground"
                data-testid="rows-stricter-only"
              >
                {t("rowFilters.onlyEveryRow")}
              </p>
            )}
            {!enabled ? (
              <p className="text-sm text-muted-foreground">
                {t("rowFilters.off")}
              </p>
            ) : (
              <div className="space-y-3">
                {rules.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    {t("rowFilters.noRules")}
                  </p>
                )}
                {rules.map((rule, index) => (
                  <div
                    key={rule.id ?? `new-${index}`}
                    className="space-y-2 rounded-[4px] border border-border p-3"
                    data-testid="rows-rule"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-mono uppercase tracking-[0.14em] text-muted-foreground">
                        {t("rowFilters.for")}
                      </span>
                      <Select
                        value={rule.everyone ? "everyone" : "group"}
                        onValueChange={(value) =>
                          update(index, { everyone: value === "everyone" })
                        }
                      >
                        <SelectTrigger className="w-44">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="group">
                            {t("rowFilters.aGroup")}
                          </SelectItem>
                          <SelectItem value="everyone">
                            {t("rowFilters.everyone")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {!rule.everyone && (
                        <div className="min-w-56 flex-1">
                          <PrincipalPicker
                            kinds={["group"]}
                            value={rule.group}
                            onChange={(group) => update(index, { group })}
                            placeholder={t("rowFilters.pickGroup")}
                          />
                        </div>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="ml-auto"
                        aria-label={t("rowFilters.removeRule")}
                        onClick={() =>
                          setRules((list) => list.filter((_, i) => i !== index))
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    {rule.conditions.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        {t("rowFilters.everyRowRule")}
                      </p>
                    )}
                    {rule.conditions.map((condition, at) => (
                      <div
                        key={at}
                        className="flex flex-wrap items-center gap-2"
                        data-testid="rows-condition"
                      >
                        {at > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {t("rowFilters.andLabel")}
                          </span>
                        )}
                        <Select
                          value={condition.column}
                          onValueChange={(column) =>
                            updateCondition(index, at, { column })
                          }
                        >
                          <SelectTrigger className="w-44">
                            <SelectValue placeholder={t("rowFilters.column")} />
                          </SelectTrigger>
                          <SelectContent>
                            {columns.map((column) => (
                              <SelectItem key={column} value={column}>
                                {column}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={condition.op}
                          onValueChange={(op) =>
                            updateCondition(index, at, {
                              op: op as DraftCondition["op"],
                            })
                          }
                        >
                          <SelectTrigger className="w-36">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="in">
                              {t("rowFilters.op.in")}
                            </SelectItem>
                            <SelectItem value="not_in">
                              {t("rowFilters.op.not_in")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          className="min-w-48 flex-1"
                          value={condition.values}
                          placeholder={t("rowFilters.values")}
                          onChange={(event) =>
                            updateCondition(index, at, {
                              values: event.target.value,
                            })
                          }
                          data-testid="rows-values"
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t("rowFilters.removeCondition")}
                          onClick={() =>
                            update(index, {
                              conditions: rule.conditions.filter(
                                (_, i) => i !== at,
                              ),
                            })
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                    {rule.conditions.length < 5 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          update(index, {
                            conditions: [
                              ...rule.conditions,
                              {
                                column: columns[0] ?? "",
                                op: "in",
                                values: "",
                              },
                            ],
                          })
                        }
                      >
                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                        {t("rowFilters.addCondition")}
                      </Button>
                    )}
                  </div>
                ))}
                {rules.length < 20 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setRules((list) => [
                        ...list,
                        {
                          everyone: false,
                          group: null,
                          conditions: [
                            { column: columns[0] ?? "", op: "in", values: "" },
                          ],
                        },
                      ])
                    }
                    data-testid="rows-add-rule"
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    {t("rowFilters.addRule")}
                  </Button>
                )}
              </div>
            )}
            <div className="flex justify-end">
              <Button
                onClick={() => void save()}
                disabled={busy}
                data-testid="rows-save"
              >
                {t("rowFilters.save")}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
