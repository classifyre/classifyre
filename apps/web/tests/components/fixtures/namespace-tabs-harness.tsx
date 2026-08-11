"use client";

import * as React from "react";
import {
  NamespaceTabs,
  type NamespaceTabItem,
} from "@workspace/ui/components/namespace-tabs";
import {
  ActiveNamespacesProvider,
  useActiveNamespaces,
} from "@/components/active-namespaces-provider";
import { currentNamespaceHref } from "@/lib/active-namespaces";

const INITIAL_ITEMS: NamespaceTabItem[] = [
  { id: "alpha", label: "Alpha investigation" },
  { id: "beta", label: "Beta review" },
];

export function NamespaceTabsHarness() {
  const [items, setItems] = React.useState(INITIAL_ITEMS);
  const [activeId, setActiveId] = React.useState("alpha");

  const close = (id: string) => {
    const index = items.findIndex((item) => item.id === id);
    const next = items.filter((item) => item.id !== id);
    setItems(next);
    if (id === activeId) {
      setActiveId(next[index]?.id ?? next[index - 1]?.id ?? "");
    }
  };

  return (
    <>
      <NamespaceTabs
        items={items}
        activeId={activeId}
        ariaLabel="Active workspaces"
        closeLabel={(item) => `Deactivate ${item.label}`}
        onActivate={setActiveId}
        onClose={close}
      />
      <output data-testid="active-workspace">{activeId || "none"}</output>
    </>
  );
}

function ActiveNamespacesFlow() {
  const { items, activate } = useActiveNamespaces();
  const [route, setRoute] = React.useState<"directory" | "alpha" | "beta">(
    "directory",
  );

  if (route === "directory") {
    return (
      <>
        <button
          onClick={() => {
            activate({
              id: "alpha-id",
              slug: "alpha",
              name: "Alpha investigation",
              href: "/alpha",
            });
            window.history.replaceState(null, "", "/alpha");
            setRoute("alpha");
          }}
        >
          Open Alpha
        </button>
        <button
          onClick={() => {
            activate({
              id: "beta-id",
              slug: "beta",
              name: "Beta review",
              href: "/beta",
            });
            window.history.replaceState(null, "", "/beta");
            setRoute("beta");
          }}
        >
          Open Beta
        </button>
      </>
    );
  }

  return (
    <>
      <button
        onClick={() => {
          window.history.replaceState(null, "", "/");
          const active = items.find((item) => item.slug === route);
          if (active) {
            activate({
              ...active,
              href: currentNamespaceHref(active.slug, active.href),
            });
          }
          setRoute("directory");
        }}
      >
        Back to workspaces
      </button>
      <button
        onClick={() => {
          const alpha = items.find((item) => item.slug === "alpha");
          if (!alpha) return;
          window.history.replaceState(null, "", alpha.href);
          setRoute("alpha");
        }}
      >
        Switch to Alpha
      </button>
      <div aria-label="Remembered workspaces">
        {items.map((item) => (
          <span key={item.id} data-testid={`remembered-${item.slug}`}>
            {item.name}:{item.href}
          </span>
        ))}
      </div>
    </>
  );
}

export function ActiveNamespacesFlowHarness() {
  return (
    <ActiveNamespacesProvider>
      <ActiveNamespacesFlow />
    </ActiveNamespacesProvider>
  );
}
