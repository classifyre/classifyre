import * as React from "react";

interface AiAssistedCardProps {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}

export function AiAssistedCard({
  title,
  description,
  children,
}: AiAssistedCardProps) {
  return (
    <section aria-label={title}>
      {description ? <p>{description}</p> : null}
      {children}
    </section>
  );
}
