"use client";

import * as React from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronDownIcon } from "lucide-react";

import { cn } from "@workspace/ui/lib/utils";

function Accordion({
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Root>) {
  return <AccordionPrimitive.Root data-slot="accordion" {...props} />;
}

function AccordionItem({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn(
        "flex flex-col overflow-hidden rounded-[6px] border-2 border-border bg-card",
        className,
      )}
      {...props}
    />
  );
}

function AccordionTitle({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="accordion-title"
      className={cn(
        "block text-xs font-mono font-bold uppercase tracking-[0.12em] text-primary-foreground",
        className,
      )}
      {...props}
    />
  );
}

function AccordionCaption({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="accordion-caption"
      className={cn(
        "block text-[10px] font-mono text-primary-foreground/60",
        className,
      )}
      {...props}
    />
  );
}

type AccordionTriggerProps = React.ComponentProps<
  typeof AccordionPrimitive.Trigger
> & {
  caption?: React.ReactNode;
  action?: React.ReactNode;
};

function AccordionTrigger({
  caption,
  action,
  className,
  children,
  ...props
}: AccordionTriggerProps) {
  const isSimpleLabel =
    typeof children === "string" || typeof children === "number";

  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-center justify-between gap-3 border-b-2 border-border bg-foreground px-4 py-3 text-left text-primary-foreground transition-[background-color,color,border-color] outline-none hover:bg-foreground/95 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&[data-state=open]_.accordion-chevron]:rotate-180",
          className,
        )}
        {...props}
      >
        <span
          data-slot="accordion-copy"
          className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
        >
          {isSimpleLabel ? (
            <AccordionTitle>{children}</AccordionTitle>
          ) : (
            children
          )}
          {caption ? <AccordionCaption>{caption}</AccordionCaption> : null}
        </span>
        <span className="flex items-center gap-2 shrink-0">
          {action ? (
            <span
              data-slot="accordion-action"
              className="flex items-center gap-2"
            >
              {action}
            </span>
          ) : null}
          <ChevronDownIcon className="accordion-chevron pointer-events-none size-4 shrink-0 translate-y-0.5 text-accent transition-transform duration-200" />
        </span>
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      className="data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down w-full overflow-hidden bg-card text-sm"
      {...props}
    >
      <div className={cn("bg-card px-4 py-4", className)}>{children}</div>
    </AccordionPrimitive.Content>
  );
}

export {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  AccordionTitle,
  AccordionCaption,
};
