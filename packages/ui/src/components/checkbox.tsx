"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { CheckIcon } from "lucide-react";

import { cn } from "@workspace/ui/lib/utils";

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-4 shrink-0 rounded-[4px] border-2 border-black bg-background text-transparent shadow-[2px_2px_0_#000] transition-[background-color,color,border-color,box-shadow] outline-none dark:border-[#9ca3af] dark:shadow-[2px_2px_0_#9ca3af] data-[state=checked]:border-[#0b0f0a] data-[state=checked]:bg-[#0b0f0a] data-[state=checked]:text-[#b7ff00] data-[state=checked]:shadow-[2px_2px_0_#1b2a12] dark:data-[state=checked]:border-[#b7ff00]/70 dark:data-[state=checked]:shadow-[2px_2px_0_#5b7a32] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
