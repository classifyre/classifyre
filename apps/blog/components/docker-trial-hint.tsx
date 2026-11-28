import type { ReactNode } from "react";

/** Structured copy for the Docker trial login footnote (`localhost:3000`, `admin / admin`). */
export interface DockerTrialHintCopy {
  readonly beforeHost: string;
  readonly host: string;
  readonly afterHost: string;
  readonly credentials: string;
  readonly afterCredentials: string;
}

/**
 * Shared footnote rendered beneath `DockerRunBlock` across the landing page
 * and `/get`, with light/dark palette support and optional trailing links.
 */
export function DockerTrialHint({
  copy,
  tone = "light",
  className,
  children,
}: {
  copy: DockerTrialHintCopy;
  tone?: "light" | "dark";
  className?: string;
  children?: ReactNode;
}) {
  const dark = tone === "dark";
  return (
    <p
      className={
        className ??
        (dark
          ? "mt-3 text-xs leading-6 text-white/70"
          : "mt-auto text-sm leading-6 text-muted-foreground")
      }
    >
      {copy.beforeHost}
      <span className={dark ? "font-mono text-white" : "font-mono text-foreground"}>
        {copy.host}
      </span>
      {copy.afterHost}
      <span className={dark ? "font-mono text-accent" : "font-mono text-foreground"}>
        {copy.credentials}
      </span>
      {copy.afterCredentials}
      {children}
    </p>
  );
}
