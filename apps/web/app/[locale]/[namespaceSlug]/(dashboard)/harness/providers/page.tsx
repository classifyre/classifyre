"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@workspace/ui/components";
import { useNsPath } from "@/lib/ns-path";

export default function AiProvidersRedirectPage() {
  const router = useRouter();
  const nsPath = useNsPath();
  React.useEffect(() => {
    router.replace(nsPath("/harness?tab=config"));
  }, [nsPath, router]);
  return <Skeleton className="mx-auto mt-8 h-24 w-full max-w-7xl" />;
}
