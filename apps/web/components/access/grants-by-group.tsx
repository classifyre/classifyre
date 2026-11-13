"use client";

import * as React from "react";
import { TriangleAlert, Trash2, UsersRound } from "lucide-react";
import type { GrantDto, RoleDto } from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table";
import {
  SortableHead,
  sortRows,
  useTableSort,
} from "@/components/sortable-table-head";
import { useTranslation } from "@/hooks/use-translation";
import { grantsThatCannotOpen } from "@/lib/access-grants";
import { formatDate } from "@/lib/date";

type SortCol = "role" | "scope" | "until";

const COLLAPSED_CAPABILITIES = 4;

/** A role's capabilities as small chips, the first few until opened. */
function CapabilityChips({ capabilities }: { capabilities: string[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const shown = open
    ? capabilities
    : capabilities.slice(0, COLLAPSED_CAPABILITIES);
  const hidden = capabilities.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((capability) => (
        <span
          key={capability}
          className="rounded-[3px] bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
        >
          {capability}
        </span>
      ))}
      {capabilities.length > COLLAPSED_CAPABILITIES && (
        <button
          type="button"
          className="text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          onClick={() => setOpen((value) => !value)}
        >
          {open
            ? t("access.capabilitiesLess")
            : t("access.capabilitiesMore", { count: hidden })}
        </button>
      )}
    </div>
  );
}

/**
 * Grants shown by group: a section per group, a row per grant with the role,
 * what it applies to, the capabilities the role gives, and an end date. A
 * group whose roles do not open the workspace (Data reader without Viewer, …)
 * says so, since its people cannot see the workspace on those alone.
 *
 * The one access table: Settings → Access, the tenant page and a source's or
 * table's Data tab all show it, each with the grants it is limited to. They
 * differ only in how a group and a scope are named, whether the origin is
 * shown, and which grants can be removed.
 */
export function GrantsByGroup({
  grants,
  roles,
  groupLabel,
  scopeLabel,
  showOrigin = false,
  canRemove,
  onRemove,
  contextGrants,
  emptyLabel,
}: {
  grants: GrantDto[];
  roles: RoleDto[];
  groupLabel: (grant: GrantDto) => string;
  scopeLabel: (grant: GrantDto) => React.ReactNode;
  /** Whether a grant came from the tenant or the owning group, or was made here. */
  showOrigin?: boolean;
  canRemove: (grant: GrantDto) => boolean;
  onRemove: (grant: GrantDto) => void;
  /**
   * Every grant of the workspace, when `grants` shows only some of them (the
   * ones that reach one source or table): a group's Viewer is not a row there
   * but still decides whether its Data reader can be reached.
   */
  contextGrants?: GrantDto[];
  /** What to say when there are no grants; "Nobody has access yet." by default. */
  emptyLabel?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const sort = useTableSort<SortCol>("role");
  const { sortCol, sortDir } = sort;

  const role = React.useCallback(
    (key: string) => roles.find((candidate) => candidate.key === key),
    [roles],
  );
  const roleTitle = React.useCallback(
    (key: string) => role(key)?.title ?? key,
    [role],
  );
  const stuck = React.useMemo(
    () => grantsThatCannotOpen(contextGrants ?? grants, roles),
    [contextGrants, grants, roles],
  );

  const sections = React.useMemo(() => {
    const sorted = sortRows(
      grants,
      (grant) =>
        sortCol === "scope"
          ? grant.scopeLabel
          : sortCol === "until"
            ? grant.expiresAt
            : roleTitle(grant.roleKey),
      sortDir,
    );
    const byGroup = new Map<string, GrantDto[]>();
    for (const grant of sorted) {
      const list = byGroup.get(grant.subjectId) ?? [];
      list.push(grant);
      byGroup.set(grant.subjectId, list);
    }
    return [...byGroup.entries()]
      .map(([subjectId, rows]) => ({
        subjectId,
        label: groupLabel(rows[0]!),
        rows,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [grants, sortCol, sortDir, roleTitle, groupLabel]);

  if (grants.length === 0) {
    return (
      <p className="rounded-[4px] border border-border px-3 py-4 text-center text-sm text-muted-foreground">
        {emptyLabel ?? t("access.none")}
      </p>
    );
  }

  return (
    <div className="space-y-4" data-testid="grants-by-group">
      {sections.map(({ subjectId, label, rows }) => {
        const stuckRows = rows.filter((grant) => stuck.has(grant.id));
        return (
          <section
            key={subjectId}
            className="space-y-1"
            data-testid="grants-group"
          >
            <div className="flex flex-wrap items-center gap-2 px-1">
              <Badge variant="outline" className="gap-1.5 py-1">
                <UsersRound
                  className="h-3 w-3 text-muted-foreground"
                  aria-hidden
                />
                <span className="max-w-[320px] truncate font-medium">
                  {label}
                </span>
              </Badge>
              <span className="text-xs text-muted-foreground">
                {t("access.rolesCount", { count: rows.length })}
              </span>
            </div>
            {stuckRows.length > 0 && (
              <div
                role="alert"
                data-testid="grants-cannot-open"
                className="flex items-start gap-2 rounded-[4px] border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
              >
                <TriangleAlert
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                  aria-hidden
                />
                <span>
                  {t("access.cannotOpen", {
                    roles: [
                      ...new Set(stuckRows.map((g) => roleTitle(g.roleKey))),
                    ].join(", "),
                  })}
                </span>
              </div>
            )}
            <div className="overflow-x-auto rounded-[4px] border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead
                      label={t("access.grantsTable.role")}
                      column="role"
                      sort={sort}
                    />
                    <TableHead>
                      <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        {t("access.grantsTable.capabilities")}
                      </span>
                    </TableHead>
                    <SortableHead
                      label={t("access.grantsTable.scope")}
                      column="scope"
                      sort={sort}
                    />
                    <SortableHead
                      label={t("access.grantsTable.until")}
                      column="until"
                      sort={sort}
                    />
                    {showOrigin && (
                      <TableHead>
                        <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          {t("access.grantsTable.origin")}
                        </span>
                      </TableHead>
                    )}
                    <TableHead className="text-right">
                      <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        {t("access.grantsTable.actions")}
                      </span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((grant) => (
                    <TableRow key={grant.id}>
                      <TableCell className="font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          {roleTitle(grant.roleKey)}
                          {stuck.has(grant.id) && (
                            <span title={t("access.cannotOpenRow")}>
                              <TriangleAlert
                                className="h-3.5 w-3.5 text-amber-600"
                                aria-label={t("access.cannotOpenRow")}
                              />
                            </span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[320px]">
                        <CapabilityChips
                          capabilities={role(grant.roleKey)?.capabilities ?? []}
                        />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {scopeLabel(grant)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {grant.expiresAt ? formatDate(grant.expiresAt) : "—"}
                      </TableCell>
                      {showOrigin && (
                        <TableCell>
                          {grant.inherited ? (
                            <Badge variant="outline">
                              {t("access.inherited")}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {t("access.grantsTable.here")}
                            </span>
                          )}
                        </TableCell>
                      )}
                      <TableCell className="text-right">
                        {canRemove(grant) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={t("access.remove")}
                            onClick={() => void onRemove(grant)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
