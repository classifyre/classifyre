"use client";

import * as React from "react";
import { Columns3, CornerDownRight } from "lucide-react";
import { api, type ColumnLineageStepDto } from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/badge";
import { EmptyState } from "@workspace/ui/components/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Spinner } from "@workspace/ui/components/spinner";

/**
 * What feeds one column, and through what.
 *
 * Separate from the graph because it answers a different question. The graph
 * says this table depends on that one; this says dropping `placed_on` breaks
 * exactly `delivery_time` and nothing else — which is the version of the
 * question anyone actually has before they change a schema.
 */
export function ColumnLineagePanel({
  assetId,
  columns,
}: {
  assetId: string;
  columns: string[];
}) {
  const [column, setColumn] = React.useState<string>(columns[0] ?? "");
  const [steps, setSteps] = React.useState<ColumnLineageStepDto[]>([]);
  const [indirect, setIndirect] = React.useState<ColumnLineageStepDto[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!column) return;
    let active = true;
    setLoading(true);
    api.graph
      .graphControllerColumnLineage({
        columnLineageDto: { assetId, column, depth: 3 },
      })
      .then((result) => {
        if (!active) return;
        setSteps(result.steps ?? []);
        setIndirect(result.indirect ?? []);
      })
      .catch(() => {
        if (active) {
          setSteps([]);
          setIndirect([]);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [assetId, column]);

  if (columns.length === 0) return null;

  return (
    <div className="space-y-3 rounded border-2 border-border bg-background p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Columns3 className="h-4 w-4 text-muted-foreground" />
        <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          Column lineage
        </span>
        <Select value={column} onValueChange={setColumn}>
          <SelectTrigger className="h-8 w-[220px]">
            <SelectValue placeholder="Pick a column" />
          </SelectTrigger>
          <SelectContent>
            {columns.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <Spinner label="Column lineage" />
      ) : steps.length === 0 && indirect.length === 0 ? (
        <EmptyState
          icon={Columns3}
          title="No column lineage for this column"
          description={
            "Column-level detail comes from sources that can report it — a view " +
            "definition, or a warehouse that tracks it. The table-level graph " +
            "above may still show where this asset came from."
          }
        />
      ) : (
        <>
          {steps.length > 0 && (
            <StepTable
              caption={`What ${column} is computed from`}
              steps={steps}
            />
          )}
          {indirect.length > 0 && (
            <StepTable
              caption="Columns that shaped which rows came out"
              hint={
                "An ORDER BY, a WHERE or a join key. These did not feed the " +
                "value, so changing one changes which rows you get, not what is in them."
              }
              steps={indirect}
            />
          )}
        </>
      )}
    </div>
  );
}

function StepTable({
  caption,
  hint,
  steps,
}: {
  caption: string;
  hint?: string;
  steps: ColumnLineageStepDto[];
}) {
  return (
    <div className="space-y-1.5">
      <p className="font-serif text-sm font-black uppercase tracking-[0.06em]">
        {caption}
      </p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-xs">
          <tbody>
            {steps.map((step, index) => (
              <tr
                key={`${step.assetId}:${step.column}:${index}`}
                className="border-t border-border align-top"
              >
                <td className="whitespace-nowrap py-2 pr-3">
                  <span
                    className="inline-flex items-center gap-1 text-muted-foreground"
                    style={{ paddingLeft: `${(step.depth - 1) * 12}px` }}
                  >
                    {step.depth > 1 && <CornerDownRight className="h-3 w-3" />}
                    <span className="font-mono">{step.assetLabel}</span>
                  </span>
                </td>
                <td className="py-2 pr-3 font-mono">
                  {(step.upstreams ?? []).join(", ") || "—"}
                </td>
                <td className="py-2 pr-3">
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {step.type}
                  </Badge>
                </td>
                <td className="py-2 font-mono text-[11px] text-muted-foreground">
                  {step.transform ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
