"use client";

import * as React from "react";

import {
  AssistantWorkflowPanel,
  type AssistantPanelMessage,
} from "@workspace/ui/components";

type DemoScriptStep = {
  delayMs: number;
  message: AssistantPanelMessage;
};

const DEMO_STEPS: readonly DemoScriptStep[] = [
  {
    delayMs: 700,
    message: {
      id: "demo-user-1",
      role: "user",
      content: "Integrate our Snowflake source.",
    },
  },
  {
    delayMs: 1200,
    message: {
      id: "demo-assistant-1",
      role: "assistant",
      content:
        "I can set that up. First I need the warehouse identifier you want in Classifyre and the business-facing name operators should see in the console.",
    },
  },
  {
    delayMs: 1100,
    message: {
      id: "demo-user-2",
      role: "user",
      content: 'Use "snowflake-prod-finance" and call it "Finance Warehouse".',
    },
  },
  {
    delayMs: 1400,
    message: {
      id: "demo-assistant-2",
      role: "assistant",
      content:
        "Perfect. I've staged the Snowflake source draft with that identifier. You can either paste credentials here and I'll validate the connection, or enter them yourself in the connection form. Which route do you prefer?",
      toolCalls: [{ name: "Source draft", status: "staged" }],
      attachments: [
        {
          title: "Source draft",
          payload: {
            sourceType: "snowflake",
            sourceId: "snowflake-prod-finance",
            displayName: "Finance Warehouse",
          },
        },
      ],
    },
  },
  {
    delayMs: 1000,
    message: {
      id: "demo-user-3",
      role: "user",
      content: "I'll fill them out in the form myself.",
    },
  },
  {
    delayMs: 1400,
    message: {
      id: "demo-assistant-3",
      role: "assistant",
      content:
        "Understood. I'll leave credentials unset and keep the workflow moving. What do you want to detect in this source?",
      toolCalls: [{ name: "Credentials mode", status: "provided" }],
    },
  },
  {
    delayMs: 1100,
    message: {
      id: "demo-user-4",
      role: "user",
      content: "Detect leaked credit cards and social security numbers.",
    },
  },
  {
    delayMs: 1400,
    message: {
      id: "demo-assistant-4",
      role: "assistant",
      content:
        "I'm adding the built-in PII detector pack for payment card numbers and social security numbers.",
      toolCalls: [{ name: "detector.pack", status: "ready" }],
      attachments: [
        {
          title: "Built-in detectors",
          payload: {
            pack: "PII",
            includes: ["credit_card_number", "social_security_number"],
          },
        },
      ],
    },
  },
  {
    delayMs: 1100,
    message: {
      id: "demo-user-5",
      role: "user",
      content: "Also detect EU-country IBANs.",
    },
  },
  {
    delayMs: 1500,
    message: {
      id: "demo-assistant-5",
      role: "assistant",
      content:
        "I'll add a custom ruleset detector for EU-country IBAN formats and route those matches into the same findings stream.",
      toolCalls: [{ name: "Custom detector", status: "staged" }],
      attachments: [
        {
          title: "Custom detector",
          payload: {
            detectorType: "RULESET",
            label: "EU IBAN",
            scope: "EU country formats",
          },
        },
      ],
    },
  },
  {
    delayMs: 1100,
    message: {
      id: "demo-assistant-6",
      role: "assistant",
      content:
        "One operating detail before I finish: should I scan all records or only new data, and when should the job run?",
    },
  },
  {
    delayMs: 1000,
    message: {
      id: "demo-user-6",
      role: "user",
      content: "Only new data. Run every working day in the morning.",
    },
  },
  {
    delayMs: 1600,
    message: {
      id: "demo-assistant-7",
      role: "assistant",
      content:
        "Done. I've configured incremental scans for new rows only and scheduled the workflow for 09:00 Europe/Vienna every Monday through Friday. The package is ready: 1 Snowflake source, 1 built-in PII pack, 1 custom EU IBAN ruleset, weekday morning execution.",
      toolCalls: [
        { name: "Sampling plan", status: "ready" },
        { name: "Schedule plan", status: "ready" },
      ],
      attachments: [
        {
          title: "Run plan",
          payload: {
            scanMode: "incremental",
            cadence: "Mon-Fri",
            time: "09:00 Europe/Vienna",
          },
        },
      ],
    },
  },
] as const;

export function AssistantDemo() {
  const [stepIndex, setStepIndex] = React.useState(0);
  const [messages, setMessages] = React.useState<AssistantPanelMessage[]>([]);

  React.useEffect(() => {
    if (stepIndex >= DEMO_STEPS.length) {
      return;
    }

    const step = DEMO_STEPS[stepIndex];
    if (!step) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setMessages((current) => [...current, step.message]);
      setStepIndex((current) => current + 1);
    }, step.delayMs);

    return () => window.clearTimeout(timeout);
  }, [stepIndex]);

  const isRunning = stepIndex < DEMO_STEPS.length;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 grid-cols-1 xl:grid-cols-2">
        <div className="space-y-4">
          <h2 className="font-serif text-4xl uppercase leading-[0.9] tracking-[0.06em] sm:text-5xl">
            See the assistant drive setup
          </h2>
          <p className="max-w-3xl text-base leading-7 sm:text-lg">
            The assistant narrows scope, stages source and detector
            configuration, and returns an exact operating plan instead of
            leaving the user in a generic chat loop.
          </p>
        </div>

        <div className="relative h-[500px]">
          <AssistantWorkflowPanel
            title="Classifyre Assistant"
            subtitle="Example walkthrough"
            messages={messages}
            input=""
            onInputChange={() => {}}
            onSend={() => {}}
            canSend={false}
            disabled
            placeholder="Demo playback is scripted. Open the live demo to continue the workflow yourself."
            footerNote={
              isRunning
                ? "Playback is showing a realistic assistant-led setup conversation."
                : "Replay the walkthrough or open the live demo to try the real assistant."
            }
          />
        </div>
      </div>
    </div>
  );
}
