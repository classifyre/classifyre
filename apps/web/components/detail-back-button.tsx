"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";

type DetailBackButtonProps = {
  fallbackHref: string;
  className?: string;
};

export function DetailBackButton({
  fallbackHref,
  className,
}: DetailBackButtonProps) {
  const router = useRouter();

  const handleClick = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallbackHref);
  };

  return (
    <Button
      variant="outline"
      size="icon"
      className={cn(
        "rounded-[4px] border-2 border-black shadow-[3px_3px_0_#000]",
        className,
      )}
      onClick={handleClick}
    >
      <ArrowLeft className="h-4 w-4" />
    </Button>
  );
}
