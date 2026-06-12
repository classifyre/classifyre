"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { api, type InquiryResponseDto } from "@workspace/api-client";
import { InquiryForm } from "@/components/inquiry-form";

export default function EditInquiryPage() {
  const params = useParams();
  const inquiryId = params.id as string;
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
