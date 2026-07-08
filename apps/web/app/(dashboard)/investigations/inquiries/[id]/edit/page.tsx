"use client";

import * as React from "react";
import { api, type InquiryResponseDto } from "@workspace/api-client";
import { InquiryForm } from "@/components/inquiry-form";
import { useRouteId } from "@/lib/use-route-id";

export default function EditInquiryPage() {
  const inquiryId = useRouteId();
  const [inquiry, setInquiry] = React.useState<InquiryResponseDto | null>(null);

  React.useEffect(() => {
    void api.inquiries.inquiriesControllerFindOne({ id: inquiryId })
      .then(setInquiry)
      .catch(console.error);
  }, [inquiryId]);

  if (!inquiry) {
    return <div className="text-muted-foreground py-12 text-center text-sm">Loading inquiry…</div>;
  }

  return <InquiryForm mode="edit" inquiryId={inquiryId} initial={inquiry} />;
}
