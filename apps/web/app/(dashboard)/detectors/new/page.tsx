"use client";

import { useRouter } from "next/navigation";
import { DetectorCreatorForm } from "@/components/detector-creator-form";

export default function NewCustomDetectorPage() {
  const router = useRouter();

  return (
    <div className="container max-w-6xl py-8 space-y-6">
      <DetectorCreatorForm
        onCreated={(detector) => {
          router.push(`/detectors/${detector.id}`);
        }}
        onCancel={() => router.push("/detectors")}
      />
    </div>
  );
}
