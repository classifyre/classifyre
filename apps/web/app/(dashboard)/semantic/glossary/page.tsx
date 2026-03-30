"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function GlossaryListPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/semantic");
  }, [router]);

  return null;
}
