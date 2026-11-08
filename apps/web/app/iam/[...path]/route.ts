import { type NextRequest } from "next/server";
import { forwardIamRequest } from "@/lib/iam/forward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    path?: string[];
  }>;
};

/**
 * The identity server behind the web app (docs/prd/IAM-access-management.md
 * §9). Browsers reach Keycloak only through here: the ingress routes
 * `<host>/iam` to the web service, and this handler forwards to the
 * in-cluster `<release>-iam:8080` service.
 *
 * Why a proxy rather than a direct ingress route: external systems documented
 * at `/docs` and every other path already go via web, which is the single
 * public entrance. Keycloak staying a ClusterIP service keeps that contract —
 * one public service, internal traffic between pods — and the admin console
 * and the master realm stay unreachable from outside unless
 * `iam.exposeAdminConsole` is on.
 *
 * Only the realm endpoints and the theme's static files are forwarded
 * (`/iam/realms/<realm>`, `/iam/resources`); everything else (`/iam/admin`,
 * `/iam/realms/master`, …) 404s here. The header contract mirrors the `/api`
 * proxy: hop-by-hop and body-describing headers are stripped because `fetch`
 * decodes the upstream body before it is re-sent.
 */

async function proxy(request: NextRequest, context: RouteContext) {
  const { path = [] } = await context.params;
  return forwardIamRequest(
    request,
    path.filter((segment) => segment !== ""),
  );
}

export function GET(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

export function POST(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

export function OPTIONS(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

export function HEAD(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

export function PUT(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

export function PATCH(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

export function DELETE(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}
