/**
 * Actor references, as the API stores them (apps/api/src/identity/actor-ref.ts):
 * `user:<sub>`, `group:<id>`, `mcp:<tokenId>`, `agent:<kind>`, `system:<job>`, optionally
 * `@mcp:<tokenId>` for an action delegated through a token or `@sql:<connectionId>`
 * for a read through a SQL connection. Anything else is a self-declared name.
 */
export type ActorKind = "user" | "group" | "mcp" | "agent" | "system" | "name";

const TYPED_REF =
  /^(user|group|mcp|agent|system):([A-Za-z0-9._:-]+?)(?:@(?:mcp|sql):([A-Za-z0-9-]+))?$/;

export function actorKind(ref: string): ActorKind {
  const match = TYPED_REF.exec(ref);
  return match ? (match[1] as ActorKind) : "name";
}

/** True when the reference needs the API to be named (tokens, people, groups). */
export function needsResolving(ref: string): boolean {
  const kind = actorKind(ref);
  return (
    kind === "mcp" ||
    kind === "user" ||
    kind === "group" ||
    ref.includes("@mcp:") ||
    ref.includes("@sql:")
  );
}
