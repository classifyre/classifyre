import { NextResponse } from "next/server";
import { checkDeploymentReadiness } from "@/lib/iam/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Polled by `/auth/starting/` until the API, identity server, initial tenant,
 * and (in Docker all-in-one) first-run workspace bootstrap are all ready.
 */
export async function GET() {
  const status = await checkDeploymentReadiness({ force: true });
  return NextResponse.json(status, {
    status: status.ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
