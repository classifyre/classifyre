/**
 * Cookie-consent state shared by the marketing site, the docs site and the web
 * app. Browser-only — every reader touches `document.cookie` or `Intl`.
 *
 * Model
 * -----
 * A visitor is in one of three states:
 *
 *   - **undecided** — no consent cookie. Analytics runs only if consent is not
 *     legally required for them (see {@link isConsentRequiredRegion}).
 *   - **granted**   — analytics may load.
 *   - **denied**    — analytics must not load, anywhere, regardless of region.
 *
 * The decision lives in a first-party cookie rather than localStorage so it
 * survives across the `www` marketing site and is readable by the server if we
 * ever need to render the banner server-side. It is strictly necessary under
 * GDPR/ePrivacy (it stores the consent choice itself), so it is set without
 * asking — that is the one cookie the regulation lets you set unprompted.
 *
 * Consent is a *decision*, not a session: it is versioned, so bumping
 * {@link COOKIE_CONSENT_VERSION} after a material change to what we collect
 * invalidates every stored decision and re-asks.
 */

export type CookieConsentDecision = "granted" | "denied";

/** Cookie holding the decision, as `v<version>:<decision>`. */
export const COOKIE_CONSENT_NAME = "classifyre-cookie-consent";

/**
 * Bump when the set of non-essential cookies changes materially (a new
 * analytics vendor, a new purpose). Old decisions stop matching and visitors
 * are asked again.
 */
export const COOKIE_CONSENT_VERSION = 1;

/**
 * Six months. The EDPB treats consent as something that has to be refreshed at
 * a reasonable interval rather than stored forever; six months is the interval
 * most EU supervisory authorities name.
 */
export const COOKIE_CONSENT_MAX_AGE_SECONDS = 182 * 24 * 60 * 60;

/** Fired when the decision changes. Detail carries the new decision. */
export const COOKIE_CONSENT_CHANGE_EVENT = "classifyre:cookie-consent-change";

/** Fired to re-open the banner (the "Cookie settings" footer link). */
export const COOKIE_CONSENT_OPEN_EVENT = "classifyre:cookie-consent-open";

/**
 * Time zones whose visitors get an explicit consent prompt: the EEA (EU plus
 * Iceland, Liechtenstein, Norway), the UK (UK GDPR + PECR) and Switzerland
 * (revFADP). Derived from the IANA zone the browser reports.
 *
 * A time zone is a proxy, not a location: a VPN or a traveller's laptop can
 * read either way. That is acceptable here because the failure modes are mild
 * and asymmetric — a false positive shows a dismissible bar to someone who did
 * not need it, and anyone can force the prompt from the "Cookie settings"
 * link. It is also the only signal available: the marketing and docs sites are
 * static exports with no server to read a request IP, and doing IP geolocation
 * would itself process personal data before consent.
 */
const CONSENT_REQUIRED_TIME_ZONES: ReadonlySet<string> = new Set([
  // EU member states
  "Europe/Vienna",
  "Europe/Brussels",
  "Europe/Sofia",
  "Europe/Zagreb",
  "Asia/Famagusta",
  "Asia/Nicosia",
  "Europe/Nicosia",
  "Europe/Prague",
  "Europe/Copenhagen",
  "Europe/Tallinn",
  "Europe/Helsinki",
  "Europe/Mariehamn",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Busingen",
  "Europe/Athens",
  "Europe/Budapest",
  "Europe/Dublin",
  "Europe/Rome",
  "Europe/Riga",
  "Europe/Vilnius",
  "Europe/Luxembourg",
  "Europe/Malta",
  "Europe/Amsterdam",
  "Europe/Warsaw",
  "Europe/Lisbon",
  "Europe/Bucharest",
  "Europe/Bratislava",
  "Europe/Ljubljana",
  "Europe/Madrid",
  "Europe/Stockholm",
  // EU outermost regions and overseas territories the GDPR follows into
  "America/Cayenne",
  "America/Guadeloupe",
  "America/Marigot",
  "America/Martinique",
  "Indian/Mayotte",
  "Indian/Reunion",
  "Atlantic/Azores",
  "Atlantic/Madeira",
  "Atlantic/Canary",
  "Africa/Ceuta",
  // EEA/EFTA
  "Atlantic/Reykjavik",
  "Europe/Vaduz",
  "Europe/Oslo",
  "Atlantic/Jan_Mayen",
  "Arctic/Longyearbyen",
  // Equivalent regimes: UK GDPR + PECR, Swiss revFADP
  "Europe/London",
  "Europe/Belfast",
  "Europe/Guernsey",
  "Europe/Isle_of_Man",
  "Europe/Jersey",
  "Europe/Zurich",
]);

/**
 * Whether this visitor must be asked before any non-essential cookie is set.
 *
 * Returns `false` when the time zone can't be read at all (SSR, or a browser
 * with `Intl` unavailable) — callers pair this with {@link readCookieConsent},
 * and the analytics gates below only run client-side.
 */
export function isConsentRequiredRegion(): boolean {
  if (typeof window === "undefined") return false;

  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof timeZone === "string" &&
      CONSENT_REQUIRED_TIME_ZONES.has(timeZone);
  } catch {
    return false;
  }
}

/** The stored decision, or null when the visitor has not answered. */
export function readCookieConsent(): CookieConsentDecision | null {
  if (typeof document === "undefined") return null;

  const raw = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${COOKIE_CONSENT_NAME}=`))
    ?.slice(COOKIE_CONSENT_NAME.length + 1);

  if (!raw) return null;

  // Decisions from an older policy version no longer count as an answer.
  const [version, decision] = decodeURIComponent(raw).split(":");
  if (version !== `v${COOKIE_CONSENT_VERSION}`) return null;

  return decision === "granted" || decision === "denied" ? decision : null;
}

/** Persist a decision and notify every listener in the page. */
export function writeCookieConsent(decision: CookieConsentDecision): void {
  if (typeof document === "undefined") return;

  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    `${COOKIE_CONSENT_NAME}=v${COOKIE_CONSENT_VERSION}:${decision}` +
    `; path=/; max-age=${COOKIE_CONSENT_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;

  window.dispatchEvent(
    new CustomEvent<CookieConsentDecision>(COOKIE_CONSENT_CHANGE_EVENT, {
      detail: decision,
    }),
  );
}

/**
 * Whether non-essential analytics may run right now.
 *
 * An explicit decision always wins. With no decision, analytics runs only
 * outside the consent-required regions — inside them nothing loads until the
 * visitor accepts.
 */
export function isAnalyticsAllowed(): boolean {
  const decision = readCookieConsent();
  if (decision) return decision === "granted";
  return !isConsentRequiredRegion();
}

/** Subscribe to decision changes. Returns an unsubscribe function. */
export function subscribeToCookieConsent(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  window.addEventListener(COOKIE_CONSENT_CHANGE_EVENT, listener);
  return () => window.removeEventListener(COOKIE_CONSENT_CHANGE_EVENT, listener);
}

/**
 * Re-open the banner so a visitor can change their mind. GDPR Art. 7(3)
 * requires withdrawing consent to be as easy as giving it, so every site that
 * shows the banner also links to this from its footer.
 */
export function openCookieSettings(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(COOKIE_CONSENT_OPEN_EVENT));
}

/**
 * Best-effort teardown of analytics that already loaded before consent was
 * withdrawn (only reachable on a site where analytics had been running).
 *
 * - PostHog is opted out through its own SDK by the provider that owns it.
 * - `ga-disable-<id>` is Google's documented kill switch: gtag.js checks it on
 *   every call, so setting it stops collection without a reload.
 * - The `_ga*` cookies are then dropped so nothing lingers on the device.
 */
export function disableGoogleAnalytics(measurementId: string): void {
  if (typeof window === "undefined") return;

  (window as unknown as Record<string, unknown>)[
    `ga-disable-${measurementId}`
  ] = true;

  for (const entry of document.cookie.split("; ")) {
    const name = entry.split("=")[0];
    if (!name || !name.startsWith("_ga")) continue;
    // Cleared on both the exact host and the registrable domain, because
    // gtag.js sets them on the latter.
    document.cookie = `${name}=; path=/; max-age=0`;
    document.cookie = `${name}=; path=/; max-age=0; domain=.${window.location.hostname}`;
  }
}
