"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function MetricsListPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/semantic");
  }, [router]);

  return null;
}
