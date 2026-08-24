"use client";

import * as React from "react";
import {
  AssistantWorkflowPanel,
  type AssistantPanelMention,
} from "@workspace/ui/components";

/**
 * Drives the assistant panel and reports what it did.
 *
 * The panel owns the caret bookkeeping the "@" menu depends on, so the test has
 * to type into the real control rather than call a helper — this harness only
 * holds the input value and the thread selection around it.
 */
export function AssistantPanelHarness({
  mentions,
}: {
  mentions: AssistantPanelMention[];
}) {
  const [input, setInput] = React.useState("");
  const [sent, setSent] = React.useState(0);
  const [threads, setThreads] = React.useState([
    { id: "first", title: "first" },
  ]);
  const [activeThreadId, setActiveThreadId] = React.useState("first");

  return (
    <div>
      <pre data-testid="panel-input-value">{input}</pre>
      <pre data-testid="sent-count">{String(sent)}</pre>
      <pre data-testid="active-thread">{activeThreadId}</pre>
      <AssistantWorkflowPanel
        title="Custom Source Builder"
        messages={[]}
        input={input}
        onInputChange={setInput}
        onSend={() => setSent((count) => count + 1)}
        canSend
        placeholder="Describe what you want built…"
        mentions={mentions}
        threads={threads.length > 1 ? threads : undefined}
        activeThreadId={activeThreadId}
        onNewThread={() => {
          const id = `thread-${threads.length + 1}`;
          setThreads((current) => [...current, { id, title: id }]);
          setActiveThreadId(id);
          setInput("");
        }}
        onSelectThread={setActiveThreadId}
      />
    </div>
  );
}
