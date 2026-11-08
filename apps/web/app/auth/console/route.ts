import { NextResponse, type NextRequest } from "next/server";
import { iamWebConfig } from "@/lib/iam/session";
import { identityConsolePath } from "@/lib/iam/console";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Opens the realm's identity console (`iam.realmConsole`), where operators
 * manage people, groups and tenants. Classifyre links here rather than to the
 * console itself, so the web app alone knows the realm and whether the console
 * is open; `?organization=<id>` lands on that tenant's organization. The
 * console is served through the `/iam` proxy and asks for its own rights:
 * anyone without them is refused there.
 */
export function GET(request: NextRequest) {
  const config = iamWebConfig();
  const path = config
    ? identityConsolePath(
        process.env,
        request.nextUrl.searchParams.get("organization"),
      )
    : null;
  if (!path) return new NextResponse(null, { status: 404 });
  return NextResponse.redirect(new URL(path, config!.appUrl), 307);
}
