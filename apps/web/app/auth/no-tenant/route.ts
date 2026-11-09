import { NextResponse, type NextRequest } from "next/server";
import de from "@/i18n/de.json";
import en from "@/i18n/en.json";
import { ID_COOKIE, iamWebConfig } from "@/lib/iam/session";

/**
 * Shown to someone who signed in but belongs to no tenant (API code
 * NO_TENANT), to several (CHOOSE_TENANT), or to one that is suspended,
 * deleted or whose organization was replaced (TENANT_*). Texts in i18n
 * (`noTenantPage`). Renewing their session changes
 * nothing, so instead of an error the page says what is wrong and who can fix
 * it. A plain page outside the app: the app itself would only meet the same
 * 401 again.
 */
const TEXT = { en: en.noTenantPage, de: de.noTenantPage } as const;

const REASONS = {
  CHOOSE_TENANT: ["severalTitle", "several", "severalFix"],
  TENANT_SUSPENDED: ["suspendedTitle", "suspended", "suspendedFix"],
  TENANT_DELETED: ["deletedTitle", "deleted", "deletedFix"],
  TENANT_REPLACED: ["replacedTitle", "replaced", "replacedFix"],
  NO_TENANT: ["title", "noTenant", "noTenantFix"],
} as const satisfies Record<string, readonly (keyof typeof en.noTenantPage)[]>;

export function GET(request: NextRequest) {
  if (!iamWebConfig()) return new NextResponse(null, { status: 404 });
  const t = request.headers.get("accept-language")?.toLowerCase().startsWith("de")
    ? TEXT.de
    : TEXT.en;
  const reason = request.nextUrl.searchParams.get("reason");
  const keys =
    reason && reason in REASONS ? REASONS[reason as keyof typeof REASONS] : REASONS.NO_TENANT;
  const [title = "", text = "", fix = ""] = keys.map((key) => t[key]);
  const who = signedInName(request.cookies.get(ID_COOKIE)?.value);

  const html = `<!doctype html>
<html lang="${t === TEXT.de ? "de" : "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · Classifyre</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f5f2; --fg: #1a1a1a; --muted: #5f5f5f; --line: #d8d6d0; --button: #1a1a1a; --button-fg: #fff; }
  @media (prefers-color-scheme: dark) { :root { --bg: #161616; --fg: #eeeeec; --muted: #a3a3a0; --line: #333; --button: #eeeeec; --button-fg: #161616; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg); font: 15px/1.55 system-ui, sans-serif; }
  main { max-width: 32rem; margin: 1rem; padding: 2rem; border: 2px solid var(--line); border-radius: 6px; }
  h1 { margin: 0 0 1rem; font-size: 1.35rem; }
  p { margin: 0 0 .9rem; }
  .muted { color: var(--muted); font-size: .9rem; }
  .actions { display: flex; gap: .75rem; margin-top: 1.5rem; flex-wrap: wrap; }
  a, button { padding: .5rem 1rem; border: 2px solid var(--button); border-radius: 4px; color: var(--fg); background: none; font: inherit; text-decoration: none; cursor: pointer; }
  form { margin: 0; }
  a.primary { background: var(--button); color: var(--button-fg); }
</style>
</head>
<body>
<main>
  <h1>${escape(title)}</h1>
  <p>${escape(text)}</p>
  <p>${escape(fix)}</p>
  ${who ? `<p class="muted">${escape(t.signedInAs)} ${escape(who)}</p>` : ""}
  <div class="actions">
    <a class="primary" href="/auth/login/?returnTo=%2F">${escape(t.retry)}</a>
    <form method="post" action="/auth/logout/"><button type="submit">${escape(t.signOut)}</button></form>
  </div>
</main>
</body>
</html>`;
  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** Display only: the ID token's name, read without verifying (it came from our own cookie). */
function signedInName(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const claims = JSON.parse(
      Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as { email?: string; preferred_username?: string; name?: string };
    return claims.email ?? claims.preferred_username ?? claims.name ?? null;
  } catch {
    return null;
  }
}

function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
