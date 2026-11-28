"use client";

import { Suspense } from "react";
import { NewDataRequestForm } from "@/components/data-request/new-data-request-form";

export default function NewDataRequestPage() {
  return (
    <Suspense>
      <NewDataRequestForm />
    </Suspense>
  );
}
