"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { api, type CaseResponseDto } from "@workspace/api-client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table";
import { Input } from "@workspace/ui/components/input";
import { Badge } from "@workspace/ui/components/badge";
import { SeverityBadge } from "@workspace/ui/components/severity-badge";
import { Button } from "@workspace/ui/components/button";
import { EmptyState } from "@workspace/ui/components/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";

const STATUS_OPTIONS = ["OPEN", "IN_PROGRESS", "CLOSED", "ARCHIVED"] as const;
const ALL = "__all__";
const PAGE_SIZE = 25;

function relativeTime(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString();
}

export function CasesTable() {
  const router = useRouter();
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string>(ALL);
  const [page, setPage] = React.useState(1);
  const [data, setData] = React.useState<CaseResponseDto[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.cases.casesControllerList({
        search: search.trim() || undefined,
        status:
          statusFilter === ALL
            ? undefined
            : ([statusFilter] as ("OPEN" | "IN_PROGRESS" | "CLOSED" | "ARCHIVED")[]),
        skip: (page - 1) * PAGE_SIZE,
        limit: PAGE_SIZE,
      });
      setData(res.items);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, page]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search cases…"
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
          className="max-w-xs"
        />
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setPage(1);
            setStatusFilter(v);
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s.replace("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead className="text-right">Evidence</TableHead>
              <TableHead className="text-right">Hypotheses</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((c) => (
              <TableRow
                key={c.id}
                className="cursor-pointer"
                onClick={() => router.push(`/investigations/${c.id}`)}
              >
                <TableCell className="font-medium">{c.title}</TableCell>
                <TableCell>
                  <Badge variant="outline">{c.status.replace("_", " ")}</Badge>
                </TableCell>
                <TableCell>
                  <SeverityBadge severity={c.severity.toLowerCase() as never}>
                    {c.severity}
                  </SeverityBadge>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.evidenceCount}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.hypothesisCount}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {relativeTime(c.updatedAt)}
                </TableCell>
              </TableRow>
            ))}
            {!loading && data.length === 0 && (
              <TableRow>
                <TableCell colSpan={6}>
                  <EmptyState
                    title="No cases yet"
                    description="Create your first investigation to start collecting evidence."
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {total} case{total === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <span className="text-sm">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
