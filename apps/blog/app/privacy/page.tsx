import type { Metadata } from "next";
import type { ReactNode } from "react";

import { CookieSettingsButton } from "@workspace/ui/components";

import { Marker, PageHero, SectionShell } from "@/components/page-kit";
import {
  demoUrl,
  enterpriseContactEmail,
  marketingSiteUrl,
  repoUrl,
  routes,
} from "@/lib/site";

import "../landing.css";

/**
 * Privacy and cookie policy for the public Classifyre websites.
 *
 * Two things this page is deliberately careful about:
 *
 * 1. **It covers the websites, not the software.** Classifyre is Apache-2.0
 *    software people run on their own machines. For those deployments the
 *    operator is the controller and we are not a party at all — saying so
 *    plainly is what keeps an open-source project from being read as a data
 *    processor for every installation of it.
 * 2. **It matches the code.** Every cookie listed here is one the site can
 *    actually set (see `packages/ui/src/lib/cookie-consent.ts` and the
 *    analytics providers). If a vendor is added or dropped, this table and
 *    `COOKIE_CONSENT_VERSION` both have to move.
 */

/**
 * Registered operator details.
 *
 * TODO(legal): GDPR Art. 13(1)(a) requires the controller's identity — fill in
 * the registered legal name and postal address before this page goes public.
 * `postalAddress: null` renders the line as pending rather than inventing one.
 */
const operator = {
  tradingName: "Classifyre",
  legalName: null as string | null,
  postalAddress: null as string | null,
  country: "Austria, European Union",
  email: enterpriseContactEmail,
};

const lastUpdated = "4 August 2026";

export const metadata: Metadata = {
  title: "Privacy & cookie policy",
  description:
    "How the Classifyre websites handle your data: what the analytics cookies do, the legal basis for them, how to withdraw consent, and why self-hosted Classifyre deployments send us nothing at all.",
  alternates: { canonical: routes.privacy },
  openGraph: {
    title: "Classifyre — Privacy & cookie policy",
    description:
      "Analytics cookies only, consent-gated in the EEA, and nothing at all from self-hosted deployments.",
    type: "website",
  },
};

function Clause({
  id,
  number,
  title,
  children,
}: {
  id: string;
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-4 border-t-2 border-border pt-8">
      <div className="space-y-3">
        <Marker label={number} />
        <h2
          id={id}
          className="font-serif text-2xl font-black uppercase leading-tight tracking-[0.04em]"
        >
          {title}
        </h2>
      </div>
      <div className="space-y-4 text-base leading-7 text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li key={index} className="flex gap-3">
          <span aria-hidden="true" className="mt-2 h-1.5 w-3 shrink-0 bg-accent" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-foreground underline decoration-accent decoration-2 underline-offset-2 hover:text-accent"
    >
      {children}
    </a>
  );
}

/** One row of the cookie table. Kept in sync with what the code actually sets. */
const cookies: readonly {
  name: string;
  purpose: string;
  provider: string;
  retention: string;
  category: "Essential" | "Analytics";
}[] = [
  {
    name: "classifyre-cookie-consent",
    purpose:
      "Stores your answer to the cookie banner so you are not asked on every page.",
    provider: "Classifyre (first-party)",
    retention: "6 months",
    category: "Essential",
  },
  {
    name: "classifyre-blog-theme-v2",
    purpose:
      "Remembers light or dark mode. Stored in your browser's local storage, not sent anywhere.",
    provider: "Classifyre (first-party)",
    retention: "Until you clear site data",
    category: "Essential",
  },
  {
    name: "_ga, _ga_*",
    purpose:
      "Google Analytics: distinguishes one browser from another so visit counts are not double-counted.",
    provider: "Google Ireland Ltd.",
    retention: "Up to 24 months",
    category: "Analytics",
  },
  {
    name: "ph_*",
    purpose:
      "PostHog: identifies a returning browser so a sequence of page views reads as one visit.",
    provider: "PostHog (EU region)",
    retention: "Up to 12 months",
    category: "Analytics",
  },
];

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 sm:px-6 lg:px-8">
      <PageHero
        eyebrow="Privacy"
        title={
          <>
            Privacy &amp;
            <br />
            <span className="inline-block bg-accent px-[0.12em] text-black">
              cookie policy
            </span>
          </>
        }
        lede={
          <>
            Short version: this website counts page views, and only after you
            say yes. The software itself is something you run on your own
            machines — it sends us nothing, ever, and we never see what you scan
            with it.
          </>
        }
        aside={
          <div className="flex flex-col gap-3">
            <div className="border-2 border-white/20 bg-white/[0.04] p-5">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
                Applies to
              </p>
              <p className="mt-2 text-white/78">
                www.classifyre.com and docs.classifyre.com
              </p>
            </div>
            <div className="border-2 border-white/20 bg-white/[0.04] p-5">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
                Last updated
              </p>
              <p className="mt-2 text-white/78">{lastUpdated}</p>
            </div>
          </div>
        }
      />

      <SectionShell>
        <div className="mx-auto max-w-3xl space-y-10">
          <p className="text-lg leading-8 text-muted-foreground">
            This policy explains what the Classifyre websites collect, why, and
            what you can do about it. It is written to be read rather than to be
            survived, and it describes what the code on these sites actually
            does — the source is{" "}
            <ExternalLink href={repoUrl}>public</ExternalLink>, so you can check.
          </p>

          <Clause id="who-we-are" number="01" title="Who we are">
            <p>
              {operator.tradingName} is an open-source project operated from{" "}
              {operator.country}. For the websites described below we are the
              data controller within the meaning of the General Data Protection
              Regulation (GDPR).
            </p>
            <div className="border-2 border-border bg-muted/30 p-5 text-sm leading-6">
              <p>
                <strong className="text-foreground">Operator:</strong>{" "}
                {operator.legalName ?? operator.tradingName}
              </p>
              {operator.postalAddress ? (
                <p>
                  <strong className="text-foreground">Address:</strong>{" "}
                  {operator.postalAddress}
                </p>
              ) : null}
              <p>
                <strong className="text-foreground">Email:</strong>{" "}
                <a
                  href={`mailto:${operator.email}`}
                  className="text-foreground underline decoration-accent decoration-2 underline-offset-2 hover:text-accent"
                >
                  {operator.email}
                </a>
              </p>
              <p>
                <strong className="text-foreground">Website:</strong>{" "}
                {marketingSiteUrl.replace("https://", "")}
              </p>
            </div>
            <p>
              We have not appointed a Data Protection Officer; we are not
              required to. Write to the address above for anything covered by
              this policy.
            </p>
          </Clause>

          <Clause id="scope" number="02" title="What this covers — and what it does not">
            <p>This policy covers the websites we operate:</p>
            <Bullets
              items={[
                <>
                  <strong className="text-foreground">
                    {marketingSiteUrl.replace("https://", "")}
                  </strong>{" "}
                  — this site, including the blog.
                </>,
                <>
                  <strong className="text-foreground">docs.classifyre.com</strong>{" "}
                  — the documentation site.
                </>,
                <>
                  <strong className="text-foreground">demo.classifyre.com</strong>{" "}
                  — the public read-only demo, covered in section 08.
                </>,
              ]}
            />
            <p>
              It does <strong className="text-foreground">not</strong> cover the
              Classifyre software itself. Classifyre is Apache-2.0 licensed
              software that you install and run on your own machines or in your
              own cluster. When you do that, the deployment talks to your
              infrastructure and not to us: we receive no telemetry, no scan
              results, no documents, and no user accounts from it. For your own
              deployment, you are the controller and we are not involved in the
              processing at all.
            </p>
          </Clause>

          <Clause id="what-we-collect" number="03" title="What we collect">
            <p>
              <strong className="text-foreground">Server logs.</strong> Like any
              web server, our hosting provider records requests: IP address,
              time, the page requested, referrer, and browser user-agent. These
              are used to keep the site up and to spot abuse, and are not
              combined with the analytics data below.
            </p>
            <p>
              <strong className="text-foreground">Analytics, if you accept.</strong>{" "}
              If you accept analytics cookies we record which pages are read,
              in what order, for how long, roughly where from (country level),
              and on what kind of device. We use this to decide what to write
              and what to document. We do not build advertising profiles, we do
              not run ad networks, and we do not sell or rent any of it.
            </p>
            <p>
              We do not ask for an account, and there is no login on these
              sites. If you email us, we of course have your email — we keep the
              correspondence and nothing more.
            </p>
          </Clause>

          <Clause id="cookies" number="04" title="Cookies we set">
            <p>
              Essential entries are set without asking, because they are what
              make your own choices stick — that is the narrow exemption the
              ePrivacy Directive allows. Analytics cookies are set only after
              you press Accept.
            </p>

            <div className="overflow-x-auto border-2 border-border">
              <table className="w-full min-w-[38rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b-2 border-border bg-muted/40">
                    {["Name", "Category", "Purpose", "Provider", "Kept for"].map(
                      (heading) => (
                        <th
                          key={heading}
                          scope="col"
                          className="px-4 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground"
                        >
                          {heading}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {cookies.map((cookie) => (
                    <tr
                      key={cookie.name}
                      className="border-b border-border last:border-b-0 align-top"
                    >
                      <td className="px-4 py-3 font-mono text-[12px] text-foreground">
                        {cookie.name}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            cookie.category === "Essential"
                              ? "inline-flex border-2 border-border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
                              : "inline-flex border-2 border-accent bg-accent px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-black"
                          }
                        >
                          {cookie.category}
                        </span>
                      </td>
                      <td className="px-4 py-3 leading-6 text-muted-foreground">
                        {cookie.purpose}
                      </td>
                      <td className="px-4 py-3 leading-6 text-muted-foreground">
                        {cookie.provider}
                      </td>
                      <td className="px-4 py-3 leading-6 text-muted-foreground">
                        {cookie.retention}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p>
              You can change your mind at any time, and it takes one click:
            </p>
            <div className="flex flex-wrap items-center gap-3 border-2 border-border bg-muted/30 p-5">
              <CookieSettingsButton className="h-9 cursor-pointer border-2 border-accent bg-accent px-4 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-black transition-colors hover:bg-transparent hover:text-foreground hover:no-underline" />
              <span className="text-sm leading-6">
                Re-opens the consent bar so you can accept or decline again.
              </span>
            </div>
            <p>
              Your browser can also block or delete cookies wholesale, and
              Google publishes a{" "}
              <ExternalLink href="https://tools.google.com/dlpage/gaoptout">
                Google Analytics opt-out add-on
              </ExternalLink>
              . Declining costs you nothing here: every page works identically
              either way.
            </p>
          </Clause>

          <Clause id="legal-basis" number="05" title="Legal basis">
            <Bullets
              items={[
                <>
                  <strong className="text-foreground">
                    Consent (Art. 6(1)(a) GDPR)
                  </strong>{" "}
                  for analytics cookies and everything they collect. We ask
                  before anything loads, Decline is one click and sits beside
                  Accept, and refusing has no consequence for you.
                </>,
                <>
                  <strong className="text-foreground">
                    Legitimate interests (Art. 6(1)(f) GDPR)
                  </strong>{" "}
                  for server logs and abuse prevention — the interest being
                  keeping a public website available and unattacked.
                </>,
                <>
                  <strong className="text-foreground">
                    Legal obligation (Art. 6(1)(c) GDPR)
                  </strong>{" "}
                  where the law requires us to keep or produce something.
                </>,
              ]}
            />
          </Clause>

          <Clause id="processors" number="06" title="Who else sees it">
            <p>
              We keep this list short on purpose. Every name here is a processor
              acting on our instructions under Art. 28 GDPR.
            </p>
            <Bullets
              items={[
                <>
                  <strong className="text-foreground">PostHog</strong> — product
                  analytics, configured on its{" "}
                  <strong className="text-foreground">EU region</strong>, so
                  those events stay in the European Union. See the{" "}
                  <ExternalLink href="https://posthog.com/privacy">
                    PostHog privacy policy
                  </ExternalLink>
                  .
                </>,
                <>
                  <strong className="text-foreground">Google Analytics 4</strong>{" "}
                  (Google Ireland Ltd.) — page-view statistics. Google may
                  transfer data to the United States under the EU–US Data
                  Privacy Framework and standard contractual clauses. See{" "}
                  <ExternalLink href="https://policies.google.com/technologies/partner-sites">
                    how Google uses data from sites that use its services
                  </ExternalLink>
                  .
                </>,
                <>
                  <strong className="text-foreground">Our hosting provider</strong>{" "}
                  — serves the pages and keeps the request logs described in
                  section 03.
                </>,
              ]}
            />
            <p>
              Nobody else. We do not sell personal data, we have never sold
              personal data, and there are no advertising or data-broker
              integrations on these sites.
            </p>
          </Clause>

          <Clause id="retention" number="07" title="How long we keep it">
            <Bullets
              items={[
                <>
                  <strong className="text-foreground">Analytics data:</strong> up
                  to 14 months in Google Analytics, up to 12 months in PostHog,
                  after which only aggregate counts remain.
                </>,
                <>
                  <strong className="text-foreground">Server logs:</strong>{" "}
                  typically 30 days, longer only while investigating a specific
                  incident.
                </>,
                <>
                  <strong className="text-foreground">Email you send us:</strong>{" "}
                  as long as the conversation is live, and afterwards only where
                  we have a reason to keep it.
                </>,
              ]}
            />
          </Clause>

          <Clause
            id="self-hosted"
            number="08"
            title="Self-hosted deployments and the demo"
          >
            <p>
              <strong className="text-foreground">Your own installation.</strong>{" "}
              A Classifyre instance you run — desktop app, Kubernetes, or
              otherwise — does not phone home. There is no licence check, no
              usage beacon, and no crash reporting to us. Whatever it scans stays
              in your database, and you are the controller for it. The software
              is provided under the Apache-2.0 licence, which includes its
              warranty and liability terms; nothing on this page adds to them.
            </p>
            <p>
              <strong className="text-foreground">The public demo.</strong>{" "}
              <ExternalLink href={demoUrl}>demo.classifyre.com</ExternalLink> is
              a deliberately public, read-only instance we operate so people can
              look around before installing anything. It is a shop window, not a
              vault: treat everything in it as public, and do not upload real
              personal data, credentials, or anything confidential to it. We may
              reset it without notice.
            </p>
          </Clause>

          <Clause id="your-rights" number="09" title="Your rights">
            <p>
              Under the GDPR you can ask us to give you a copy of your personal
              data, correct it, delete it, restrict or object to how we use it,
              or hand it over in a portable form. Where we rely on consent, you
              can withdraw it at any time — using the button in section 04 —
              without affecting what was lawful before you did.
            </p>
            <p>
              Email{" "}
              <a
                href={`mailto:${operator.email}`}
                className="text-foreground underline decoration-accent decoration-2 underline-offset-2 hover:text-accent"
              >
                {operator.email}
              </a>
              . We answer within one month. Requests are free unless they are
              manifestly excessive.
            </p>
            <p>
              You also have the right to complain to a supervisory authority. In
              Austria that is the{" "}
              <ExternalLink href="https://www.dsb.gv.at/">
                Datenschutzbehörde
              </ExternalLink>
              ; elsewhere in the EEA, your national authority is listed by the{" "}
              <ExternalLink href="https://edpb.europa.eu/about-edpb/about-edpb/members_en">
                European Data Protection Board
              </ExternalLink>
              .
            </p>
          </Clause>

          <Clause id="children" number="10" title="Children">
            <p>
              These sites are documentation and marketing for infrastructure
              software; they are not directed at children and we do not
              knowingly collect data from anyone under 16. If you believe a
              child has sent us personal data, tell us and we will delete it.
            </p>
          </Clause>

          <Clause id="changes" number="11" title="Changes to this policy">
            <p>
              When what we collect changes materially, we update this page,
              change the date at the top, and reset the stored consent so the
              banner asks again rather than relying on an answer you gave about
              something else. Editorial fixes do not trigger that.
            </p>
            <p className="text-sm">Last updated: {lastUpdated}.</p>
          </Clause>
        </div>
      </SectionShell>
    </main>
  );
}
