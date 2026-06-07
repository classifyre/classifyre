"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@workspace/api-client";
import { Card, CardContent } from "@workspace/ui/components/card";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Textarea } from "@workspace/ui/components/textarea";
import { Label } from "@workspace/ui/components/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { CasesTable } from "@/components/cases-table";

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const;

export default function InvestigationsPage() {
  const router = useRouter();
  const [stats, setStats] = React.useState({ total: 0, open: 0, inProgress: 0 });
  const [createOpen, setCreateOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [hypothesis, setHypothesis] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [severity, setSeverity] = React.useState<string>("MEDIUM");
  const [saving, setSaving] = React.useState(false);

  const loadStats = React.useCallback(async () => {
    const [all, open, inProgress] = await Promise.all([
      api.cases.casesControllerList({ limit: 1 }),
      api.cases.casesControllerList({ limit: 1, status: ["OPEN"] }),
      api.cases.casesControllerList({ limit: 1, status: ["IN_PROGRESS"] }),
    ]);
    setStats({ total: all.total, open: open.total, inProgress: inProgress.total });
  }, []);

  React.useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const reset = () => {
    setTitle("");
    setHypothesis("");
    setDescription("");
    setSeverity("MEDIUM");
  };

  const handleCreate = async () => {
    if (!title.trim() || !hypothesis.trim()) return;
    setSaving(true);
    try {
      const created = await api.cases.casesControllerCreate({
        createCaseDto: {
          title: title.trim(),
          hypothesis: hypothesis.trim(),
          description: description.trim() || undefined,
          severity: severity as never,
        },
      });
      toast.success("Case created");
      setCreateOpen(false);
      reset();
      router.push(`/investigations/${created.id}`);
    } catch (err) {
      toast.error("Failed to create case");
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const panels = [
    { label: "Total cases", value: stats.total },
    { label: "Open", value: stats.open },
    { label: "In progress", value: stats.inProgress },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl font-black uppercase tracking-[0.04em]">
            Investigations
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Open a case from a hypothesis, collect evidence, and test competing
            theories.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          New case
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {panels.map((p) => (
          <Card key={p.label}>
            <CardContent className="p-4">
              <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                {p.label}
              </p>
              <p className="mt-1 text-3xl font-black tabular-nums">{p.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <CasesTable />

      <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) reset(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New investigation case</DialogTitle>
            <DialogDescription>
              Every case starts with a hypothesis — what do you suspect?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="case-hypothesis">
                Initial hypothesis <span className="text-destructive">*</span>
              </Label>
              <Input
                id="case-hypothesis"
                value={hypothesis}
                onChange={(e) => setHypothesis(e.target.value)}
                placeholder="e.g. Customer PII was shared externally"
                autoFocus
              />
              <p className="text-muted-foreground text-xs">
                Frame the core suspicion. Evidence will strengthen or weaken this.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="case-title">
                Case title <span className="text-destructive">*</span>
              </Label>
              <Input
                id="case-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Possible external sharing of customer data"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="case-desc">Description</Label>
              <Textarea
                id="case-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What prompted this investigation?"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Severity</Label>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); reset(); }}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!title.trim() || !hypothesis.trim() || saving}
            >
              Create case
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
