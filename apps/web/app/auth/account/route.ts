import { NextResponse } from "next/server";
import { accountPagePath } from "@/lib/iam/console";
import { iamWebConfig } from "@/lib/iam/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Opens the person's own account page in the identity server (name, email,
 * password, two-factor, sessions, language), served through the `/iam`
 * proxy in Classifyre's look. Classifyre keeps no profile of its own.
 */
export function GET() {
  const config = iamWebConfig();
  const path = accountPagePath(process.env);
  if (!path) return new NextResponse(null, { status: 404 });
  return NextResponse.redirect(new URL(path, config.appUrl), 307);
}
