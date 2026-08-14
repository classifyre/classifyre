"use client";

import { useState } from "react";

import { cn } from "@workspace/ui/lib/utils";

type ArticleSideRailProps = {
  title: string;
  path: string;
  tags?: string[];
  backHref?: string;
  backLabel?: string;
};

function XIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function LinkedInIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} {...props}>
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6Z" />
      <rect width="4" height="12" x="2" y="9" />
      <circle cx="4" cy="4" r="2" />
    </svg>
  );
}

function MailIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect width="20" height="16" x="2" y="4" rx="1" />
      <path d="m3 6 9 6 9-6" />
    </svg>
  );
}

function LinkIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M9 17H7A5 5 0 0 1 7 7h2" />
      <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
      <line x1="8" x2="16" y1="12" y2="12" />
    </svg>
  );
}

function CheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function useShareActions(title: string, path: string) {
  const [copied, setCopied] = useState(false);

  const resolveUrl = () =>
    typeof window !== "undefined" ? `${window.location.origin}${path}` : path;

  const shareOnX = () => {
    const text = encodeURIComponent(title);
    window.open(
      `https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(resolveUrl())}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const shareOnLinkedIn = () => {
    window.open(
      `https://www.linkedin.com/shareArticle?mini=true&url=${encodeURIComponent(resolveUrl())}&title=${encodeURIComponent(title)}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const shareViaEmail = () => {
    const subject = encodeURIComponent(title);
    const body = encodeURIComponent(`${title}\n\n${resolveUrl()}`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(resolveUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard API unavailable; nothing to fall back to silently.
    }
  };

  return { copied, shareOnX, shareOnLinkedIn, shareViaEmail, copyLink };
}

const iconButtonClass =
  "flex size-9 items-center justify-center border-2 border-border bg-card text-foreground shadow-[3px_3px_0_0_var(--color-border)] transition-all hover:-translate-y-0.5 hover:-translate-x-0.5 hover:shadow-[4px_4px_0_0_var(--color-border)]";

function ShareRow({
  title,
  path,
  className,
}: {
  title: string;
  path: string;
  className?: string;
}) {
  const { copied, shareOnX, shareOnLinkedIn, shareViaEmail, copyLink } = useShareActions(
    title,
    path,
  );

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <button
        type="button"
        aria-label="Share on X"
        title="Share on X"
        onClick={shareOnX}
        className={iconButtonClass}
      >
        <XIcon className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Share on LinkedIn"
        title="Share on LinkedIn"
        onClick={shareOnLinkedIn}
        className={iconButtonClass}
      >
        <LinkedInIcon className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Share via email"
        title="Share via email"
        onClick={shareViaEmail}
        className={iconButtonClass}
      >
        <MailIcon className="size-4" />
      </button>
      <button
        type="button"
        aria-label={copied ? "Link copied" : "Copy link"}
        title={copied ? "Link copied" : "Copy link"}
        onClick={copyLink}
        className={cn(iconButtonClass, copied && "bg-[#b7ff00]")}
      >
        {copied ? <CheckIcon className="size-4" /> : <LinkIcon className="size-4" />}
      </button>
    </div>
  );
}

/**
 * Nextra reserves a 256px left column for its docs page-tree nav, which is
 * always empty on blog posts (they aren't part of that tree). We fill that
 * dead space with share actions + a back link instead of leaving it blank,
 * and keep Nextra's own right-hand "On this page" TOC untouched. Below the
 * md breakpoint that column collapses entirely, so the same content also
 * renders inline, right under the hero, for mobile readers.
 */
export function ArticleSideRail({
  title,
  path,
  tags,
  backHref = "/blog/cases",
  backLabel = "All case files",
}: ArticleSideRailProps) {
  return (
    <>
      <div className="hidden md:fixed md:top-28 md:left-4 md:z-30 md:block md:w-48 lg:left-10 lg:w-52">
        <div className="space-y-5">
          <div>
            <span className="mb-2 block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
              Share
            </span>
            <ShareRow title={title} path={path} className="gap-1.5" />
          </div>

          {tags && tags.length > 0 ? (
            <div>
              <span className="mb-2 block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                Filed under
              </span>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-[4px] border-2 border-border bg-card px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <a
            href={backHref}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-foreground underline decoration-[#b7ff00] decoration-2 underline-offset-4 hover:text-muted-foreground"
          >
            &larr; {backLabel}
          </a>
        </div>
      </div>

      <div className="mb-8 flex flex-col gap-3 border-2 border-border bg-card px-4 py-3 md:hidden">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            Share this case file
          </span>
          <a
            href={backHref}
            className="shrink-0 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-foreground underline decoration-[#b7ff00] decoration-2 underline-offset-4"
          >
            &larr; {backLabel}
          </a>
        </div>
        <ShareRow title={title} path={path} />
      </div>
    </>
  );
}
