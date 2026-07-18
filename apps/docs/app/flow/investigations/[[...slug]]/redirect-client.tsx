"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function RedirectClient({ target }: { target: string }) {
  const router = useRouter();

  useEffect(() => {
    router.replace(target);
  }, [router, target]);

  return null;
}
