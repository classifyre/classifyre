"use client";

import * as React from "react";

import { cn } from "../lib/utils";
import {
  COOKIE_CONSENT_OPEN_EVENT,
  isConsentRequiredRegion,
  readCookieConsent,
  writeCookieConsent,
} from "../lib/cookie-consent";

/**
 * The consent bar: a slim strip that slides up from the bottom, states what we
 * set and why, links the policy, and offers Accept and Decline.
 *
 * Deliberate choices, all of them load-bearing for GDPR/ePrivacy:
 *
 * - **Nothing loads before a choice.** The banner does not itself gate
 *   analytics; the analytics providers do, by reading `isAnalyticsAllowed()`.
 *   The bar is only the input device.
 * - **Decline is as prominent as Accept.** Same size, same weight, adjacent —
 *   a greyed-out or hidden reject button is the single most-fined dark pattern
 *   in EU cookie enforcement.
 * - **No "X" that means consent.** Dismissing without choosing is not consent,
 *   so there is no dismiss affordance at all; the bar stays until answered.
 * - **Re-openable.** `openCookieSettings()` shows it again with the current
 *   choice preselected, which is how Art. 7(3) withdrawal is satisfied.
 *
 * It is intentionally non-modal: it does not trap focus or block the page. A
 * cookie wall would be its own compliance problem, and this site sets nothing
 * until the visitor answers anyway.
 */
export interface CookieConsentBannerProps {
  /** Where the policy lives. Relative on the marketing site, absolute elsewhere. */
  policyHref: string;
  /**
   * Set false to compile the banner out entirely — used by the web app, where
   * the chart decides per-deployment and the desktop build never shows it.
   */
  enabled?: boolean;
  /** Copy overrides, so the web app can pass translated strings. */
  copy?: Partial<CookieConsentCopy>;
  className?: string;
}

export interface CookieConsentCopy {
  message: string;
  policyLabel: string;
  accept: string;
  decline: string;
  regionLabel: string;
  ariaLabel: string;
}

const DEFAULT_COPY: CookieConsentCopy = {
  message:
    "We use analytics cookies to see which pages get read, nothing else. No ads, no profiling, no data sold. Decline and the site works exactly the same.",
  policyLabel: "Privacy & cookie policy",
  accept: "Accept",
  decline: "Decline",
  regionLabel: "Cookies",
  ariaLabel: "Cookie consent",
};

export function CookieConsentBanner({
  policyHref,
  enabled = true,
  copy,
  className,
}: CookieConsentBannerProps) {
  const [mounted, setMounted] = React.useState(false);
  const [visible, setVisible] = React.useState(false);

  const text = { ...DEFAULT_COPY, ...copy };

  React.useEffect(() => {
    if (!enabled) return;

    // Mount and slide are separate ticks: the element has to exist at
    // translate-y-full for one frame or the transition has nothing to run from.
    const show = () => {
      setMounted(true);
      window.setTimeout(() => setVisible(true), 60);
    };

    // Ask only where consent is legally required, and only while unanswered.
    if (isConsentRequiredRegion() && readCookieConsent() === null) {
      show();
    }

    // The footer's "Cookie settings" link re-opens the bar for anyone, in any
    // region, whether or not they have answered before.
    window.addEventListener(COOKIE_CONSENT_OPEN_EVENT, show);
    return () => window.removeEventListener(COOKIE_CONSENT_OPEN_EVENT, show);
  }, [enabled]);

  const decide = (decision: "granted" | "denied") => {
    writeCookieConsent(decision);
    setVisible(false);
    // Unmount after the slide-out finishes so the exit animation is visible.
    window.setTimeout(() => setMounted(false), 300);
  };

  if (!enabled || !mounted) return null;

  return (
    <div
      role="region"
      aria-label={text.ariaLabel}
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 transition-transform duration-300 ease-out motion-reduce:transition-none",
        visible ? "translate-y-0" : "translate-y-full",
        className,
      )}
    >
      <div className="border-t-2 border-border bg-background/98 backdrop-blur supports-[backdrop-filter]:bg-background/95">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:px-6 md:flex-row md:items-center md:justify-between md:gap-6">
          <div className="flex items-start gap-3 md:items-center">
            <span className="hidden shrink-0 items-center border-2 border-accent bg-accent px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-black sm:inline-flex">
              {text.regionLabel}
            </span>
            <p className="text-[13px] leading-5 text-muted-foreground">
              {text.message}{" "}
              <a
                href={policyHref}
                className="font-medium text-foreground underline decoration-accent decoration-2 underline-offset-2 hover:text-accent"
              >
                {text.policyLabel}
              </a>
              .
            </p>
          </div>

          {/* Equal weight by construction: same element, same classes, only the
              accent fill differs so Accept is findable — not so Decline is hard
              to find. */}
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => decide("denied")}
              className="h-9 flex-1 cursor-pointer border-2 border-border bg-transparent px-4 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-foreground transition-colors hover:border-foreground md:flex-none"
            >
              {text.decline}
            </button>
            <button
              type="button"
              onClick={() => decide("granted")}
              className="h-9 flex-1 cursor-pointer border-2 border-accent bg-accent px-4 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-black transition-colors hover:bg-transparent hover:text-foreground md:flex-none"
            >
              {text.accept}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Footer control that re-opens the banner. Rendered next to the privacy link
 * on every site that shows the bar, so withdrawing consent costs one click
 * from any page.
 */
export function CookieSettingsButton({
  label = "Cookie settings",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        window.dispatchEvent(new Event(COOKIE_CONSENT_OPEN_EVENT));
      }}
      className={cn("cursor-pointer underline-offset-4 hover:underline", className)}
    >
      {label}
    </button>
  );
}
