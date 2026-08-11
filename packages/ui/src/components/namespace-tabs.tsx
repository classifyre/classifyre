"use client";

import * as React from "react";
import { X } from "lucide-react";

import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { cn } from "@workspace/ui/lib/utils";

export interface NamespaceTabItem {
  /** Stable namespace identifier. */
  id: string;
  /** Human-readable namespace name. */
  label: string;
}

export interface NamespaceTabsProps extends Omit<
  React.ComponentProps<"div">,
  "onChange"
> {
  items: NamespaceTabItem[];
  activeId: string;
  ariaLabel: string;
  closeLabel: (item: NamespaceTabItem) => string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}

/**
 * A compact, window-style tab strip for switching between namespaces.
 *
 * This component owns presentation and keyboard semantics only. Consumers own
 * routing and persistence so inactive tabs can remain lightweight URL records
 * instead of hidden, mounted application trees.
 */
function NamespaceTabs({
  items,
  activeId,
  ariaLabel,
  closeLabel,
  onActivate,
  onClose,
  className,
  ...props
}: NamespaceTabsProps) {
  return (
    <div
      data-slot="namespace-tabs"
      className={cn(
        "flex h-10 min-w-0 shrink-0 items-stretch overflow-hidden",
        className,
      )}
      {...props}
    >
      <Tabs
        value={activeId}
        onValueChange={onActivate}
        className="min-w-0 flex-1 gap-0 overflow-hidden"
      >
        <TabsList
          aria-label={ariaLabel}
          className="h-10 w-full justify-start overflow-x-auto overflow-y-hidden rounded-none bg-transparent p-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {items.map((item, index) => (
            <React.Fragment key={item.id}>
              {index > 0 && (
                <span
                  aria-hidden="true"
                  className="mx-1.5 h-4 w-px shrink-0 self-center bg-muted-foreground/20"
                />
              )}
              <div
                role="presentation"
                className="group relative h-10 min-w-36 max-w-56 shrink basis-48"
              >
                <TabsTrigger
                  value={item.id}
                  title={item.label}
                  className={cn(
                    "my-1 h-8 w-full justify-start rounded-sm border-0 px-3 pr-9 text-xs font-medium",
                    "hover:bg-accent/10 hover:text-accent-foreground dark:hover:bg-accent/20",
                    "after:hidden",
                    "data-[state=active]:bg-background data-[state=active]:font-semibold data-[state=active]:shadow-sm data-[state=active]:hover:bg-background",
                    "dark:data-[state=active]:border-0 dark:data-[state=active]:bg-background dark:data-[state=active]:hover:bg-background",
                  )}
                >
                  <span className="truncate">{item.label}</span>
                </TabsTrigger>
                <button
                  type="button"
                  aria-label={closeLabel(item)}
                  title={closeLabel(item)}
                  className={cn(
                    "absolute right-2 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm",
                    "text-muted-foreground opacity-70 transition hover:bg-muted hover:text-foreground hover:opacity-100",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose(item.id);
                  }}
                >
                  <X className="size-3" />
                </button>
              </div>
            </React.Fragment>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}

export { NamespaceTabs };
