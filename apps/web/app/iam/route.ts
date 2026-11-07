import { type NextRequest } from "next/server";
import { forwardIamRequest } from "@/lib/iam/forward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The bare `/iam/` root. The `[...path]` catch-all does not match it in this
 * Next version, so without this route it falls through to Next's error page.
 * Keycloak answers it with its own welcome redirect (to the admin console),
 * which only resolves usefully when the operator exposed the console — the
 * allow-list decides, like for every other path.
 */

export function GET(request: NextRequest) {
  return forwardIamRequest(request, []);
}

export function POST(request: NextRequest) {
  return forwardIamRequest(request, []);
}

export function OPTIONS(request: NextRequest) {
  return forwardIamRequest(request, []);
}

export function HEAD(request: NextRequest) {
  return forwardIamRequest(request, []);
}
