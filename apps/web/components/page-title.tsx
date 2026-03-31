"use client";

import * as React from "react";

import { cn } from "@workspace/ui/lib/utils";

interface PageTitleProps extends React.ComponentProps<"div"> {
  title: string;
  description?: string;
}

export function PageTitle({
  title,
  description,
  className,
  ...props
}: PageTitleProps) {
  return (
    <div className={cn("space-y-1", className)} {...props}>
      <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
        {title}
      </h1>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
