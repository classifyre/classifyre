"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@workspace/ui/lib/utils";

type TabsProps = React.ComponentProps<typeof TabsPrimitive.Root> & {
  /**
   * Keep the selected tab in this query parameter. The URL is read on mount
   * and updated without navigating or discarding any other query parameters.
   * Leave unset for local tabs, such as tabs inside a dialog.
   */
  urlParam?: string;
  urlHistory?: "replace" | "push";
};

function Tabs({
  className,
  orientation = "horizontal",
  urlParam,
  urlHistory = "replace",
  value,
  defaultValue,
  onValueChange,
  ref,
  ...props
}: TabsProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const isControlled = value !== undefined;
  const [localValue, setLocalValue] = React.useState(defaultValue);
  const selectedValue = isControlled ? value : localValue;
  const latest = React.useRef({ isControlled, onValueChange, selectedValue });
  latest.current = { isControlled, onValueChange, selectedValue };

  const writeUrl = React.useCallback(
    (nextValue: string) => {
      if (!urlParam || typeof window === "undefined") return;

      const url = new URL(window.location.href);
      if (url.searchParams.get(urlParam) === nextValue) return;

      url.searchParams.set(urlParam, nextValue);
      window.history[`${urlHistory}State`](null, "", url);
    },
    [urlHistory, urlParam],
  );

  React.useEffect(() => {
    if (!urlParam) return;

    const readUrl = () => {
      const nextValue = new URL(window.location.href).searchParams.get(
        urlParam,
      );
      if (!nextValue || !rootRef.current) return;

      const valid = Array.from(
        rootRef.current.querySelectorAll<HTMLElement>(
          '[data-slot="tabs-trigger"]',
        ),
      ).some(
        (trigger) =>
          trigger.closest('[data-slot="tabs"]') === rootRef.current &&
          trigger.dataset.urlTabValue === nextValue,
      );
      if (!valid || latest.current.selectedValue === nextValue) return;

      if (!latest.current.isControlled) setLocalValue(nextValue);
      latest.current.onValueChange?.(nextValue);
    };

    readUrl();
    window.addEventListener("popstate", readUrl);
    return () => window.removeEventListener("popstate", readUrl);
  }, [urlParam]);

  const mounted = React.useRef(false);
  React.useEffect(() => {
    if (!urlParam || !isControlled || value === undefined) return;
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    writeUrl(value);
  }, [isControlled, urlParam, value, writeUrl]);

  const handleValueChange = React.useCallback(
    (nextValue: string) => {
      if (!isControlled) setLocalValue(nextValue);
      writeUrl(nextValue);
      onValueChange?.(nextValue);
    },
    [isControlled, onValueChange, writeUrl],
  );

  const setRootRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  return (
    <TabsPrimitive.Root
      ref={setRootRef}
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
        className,
      )}
      value={selectedValue}
      onValueChange={handleValueChange}
      {...props}
    />
  );
}

const tabsListVariants = cva(
  "rounded-lg p-[3px] group-data-[orientation=horizontal]/tabs:h-9 data-[variant=line]:rounded-none group/tabs-list text-muted-foreground inline-flex w-fit items-center justify-center group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  value,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      data-url-tab-value={value}
      value={value}
      className={cn(
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring text-foreground/60 hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-sm border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap transition-all group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 group-data-[variant=default]/tabs-list:data-[state=active]:shadow-sm group-data-[variant=line]/tabs-list:data-[state=active]:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent dark:group-data-[variant=line]/tabs-list:data-[state=active]:border-transparent dark:group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent",
        "data-[state=active]:bg-background dark:data-[state=active]:text-foreground dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30 data-[state=active]:text-foreground",
        "after:bg-foreground after:absolute after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants };
