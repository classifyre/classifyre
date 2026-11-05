import { NextResponse, type NextRequest } from "next/server";
import { ID_COOKIE, iamWebConfig } from "@/lib/iam/session";

/**
 * Shown to someone who signed in but belongs to no tenant (API code
 * NO_TENANT) or to several (CHOOSE_TENANT). Renewing their session changes
 * nothing, so instead of an error the page says what is wrong and who can fix
 * it. A plain page outside the app: the app itself would only meet the same
 * 401 again.
 */
const TEXT = {
  en: {
    title: "Not in a tenant yet",
    noTenant:
      "You are signed in, but your account is not in any tenant (organization) of Classifyre yet, so there is nothing to show you.",
    noTenantFix:
      "Ask a tenant admin to add you to their organization in the identity server: Organizations → their tenant → Members. Being in a group of the realm is not enough.",
    severalTitle: "Choose one tenant",
    several:
      "Your account is in several tenants. Classifyre works in one tenant at a time.",
    severalFix: "Sign in again and choose the tenant you want to work in.",
    signedInAs: "Signed in as",
    retry: "Try again",
    signOut: "Sign out",
  },
  de: {
    title: "Noch in keinem Mandanten",
    noTenant:
      "Sie sind angemeldet, aber Ihr Konto gehört noch zu keinem Mandanten (keiner Organisation) von Classifyre, daher gibt es hier nichts zu sehen.",
    noTenantFix:
      "Bitten Sie einen Mandanten-Admin, Sie im Identitätsserver zu seiner Organisation hinzuzufügen: Organizations → Mandant → Members. Eine Gruppe des Realms reicht nicht.",
    severalTitle: "Einen Mandanten wählen",
    several:
      "Ihr Konto gehört zu mehreren Mandanten. Classifyre arbeitet immer in einem.",
    severalFix: "Melden Sie sich erneut an und wählen Sie den Mandanten.",
    signedInAs: "Angemeldet als",
    retry: "Erneut versuchen",
    signOut: "Abmelden",
  },
} as const;

export function GET(request: NextRequest) {
  if (!iamWebConfig()) return new NextResponse(null, { status: 404 });
  const t = request.headers.get("accept-language")?.toLowerCase().startsWith("de")
    ? TEXT.de
    : TEXT.en;
  const several = request.nextUrl.searchParams.get("reason") === "CHOOSE_TENANT";
  const who = signedInName(request.cookies.get(ID_COOKIE)?.value);

  const html = `<!doctype html>
<html lang="${t === TEXT.de ? "de" : "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(several ? t.severalTitle : t.title)} · Classifyre</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f5f2; --fg: #1a1a1a; --muted: #5f5f5f; --line: #d8d6d0; --button: #1a1a1a; --button-fg: #fff; }
  @media (prefers-color-scheme: dark) { :root { --bg: #161616; --fg: #eeeeec; --muted: #a3a3a0; --line: #333; --button: #eeeeec; --button-fg: #161616; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg); font: 15px/1.55 system-ui, sans-serif; }
  main { max-width: 32rem; margin: 1rem; padding: 2rem; border: 2px solid var(--line); border-radius: 6px; }
  h1 { margin: 0 0 1rem; font-size: 1.35rem; }
  p { margin: 0 0 .9rem; }
  .muted { color: var(--muted); font-size: .9rem; }
  .actions { display: flex; gap: .75rem; margin-top: 1.5rem; flex-wrap: wrap; }
  a { padding: .5rem 1rem; border: 2px solid var(--button); border-radius: 4px; color: var(--fg); text-decoration: none; }
  a.primary { background: var(--button); color: var(--button-fg); }
</style>
</head>
<body>
<main>
  <h1>${escape(several ? t.severalTitle : t.title)}</h1>
  <p>${escape(several ? t.several : t.noTenant)}</p>
  <p>${escape(several ? t.severalFix : t.noTenantFix)}</p>
  ${who ? `<p class="muted">${escape(t.signedInAs)} ${escape(who)}</p>` : ""}
  <div class="actions">
    <a class="primary" href="/auth/login/?returnTo=%2F">${escape(t.retry)}</a>
    <a href="/auth/logout/">${escape(t.signOut)}</a>
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
