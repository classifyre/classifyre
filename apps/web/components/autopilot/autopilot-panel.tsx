"use client";

import * as React from "react";
import { Activity, Bot, Brain, Play } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { AutopilotActivity } from "./autopilot-activity";
import { AutopilotMemory } from "./autopilot-memory";
import { RunAutopilotDialog } from "./run-autopilot-dialog";

/**
 * The Autopilot tab of the investigations page: what the AI did (activity +
 * decision rationale + business/technical logs), what it knows (editable
 * memory) and a steer-and-run trigger.
 */
export function AutopilotPanel() {
  const [view, setView] = React.useState<"activity" | "memory">("activity");
  const [runOpen, setRunOpen] = React.useState(false);
  // Remount activity after a manual trigger so it picks the new cycle up fast.
  const [activityEpoch, setActivityEpoch] = React.useState(0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-[4px] border-2 border-border bg-card shadow-[2px_2px_0_var(--color-border)]">
          <Bot className="h-4 w-4 text-[#d97706]" />
        </span>
        <div className="flex rounded-[4px] border-2 border-border p-0.5">
          {(
            [
              { value: "activity", label: "Activity", icon: <Activity className="h-3 w-3" /> },
              { value: "memory", label: "Memory", icon: <Brain className="h-3 w-3" /> },
            ] as const
          ).map((v) => (
            <button
              key={v.value}
              onClick={() => setView(v.value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-[2px] px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors",
                view === v.value
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v.icon}
              {v.label}
            </button>
          ))}
        </div>
        <Button size="sm" className="ml-auto" onClick={() => setRunOpen(true)}>
          <Play className="h-3.5 w-3.5" /> Run autopilot
        </Button>
      </div>

      {view === "activity" ? <AutopilotActivity key={activityEpoch} /> : <AutopilotMemory />}

      <RunAutopilotDialog
        open={runOpen}
        onOpenChange={setRunOpen}
        onTriggered={() => {
          setView("activity");
          setActivityEpoch((e) => e + 1);
        }}
      />
    </div>
  );
}
