# PRD S1 · Enterprise extension seams

| | |
|---|---|
| **Status** | Proposed (recommended) |
| **Size** | S–M |
| **Milestone** | M0 · Safety and seams ([integration](00-integration-architecture.md#4-build-order-and-milestones)) |
| **Depends on** | nothing |
| **Provides** | Foundation **F6**: actor context, access policy hook, finding-content presenter, enterprise module loading |
| **Used by** | [G3](G3-outbound-webhooks-notifications-export.md), [G5](G5-entities.md), [G6](G6-triage-queue.md), [G7](G7-outcome-metrics.md), and every new endpoint |
| **Not in scope** | any governance *feature*. The open-source core keeps its current behaviour exactly |

## 1. Summary

Add four small extension points to the core, so a future enterprise edition (sign-in, roles, audit, redaction by role, purpose per case) can ship as a **module** loaded by the same application instead of a long-lived fork. In the open-source build every seam has a default that reproduces today's behaviour:

- the actor comes from `X-Actor-Name`;
- every action is allowed;
- matched content is shown in full.

## 2. Why

Governance is deliberately left out of the open-source core and will be built when the first buyer arrives. The question is how. A fork of this repository is expensive to keep current:

- **The schema is large and shared.** `apps/api/prisma/schema.prisma` is one 3,590-line file. Every model an enterprise fork adds sits next to models upstream keeps changing.
- **Migrations run everywhere.** 206 migrations run with `prisma migrate deploy` against every tenant schema (`apps/api/src/database-migrations.ts`). A conflict resolved inside an already-applied migration is never re-checked, so tenant schemas drift silently until a runtime error.
- **The core moves fast.** It had 193 commits in September 2026 alone. Each is a potential merge in a fork.
- **Identity is spread across the codebase.** It is read in 17 places through `@ActorName()` (`apps/api/src/actor-name.decorator.ts`). Finding content (`matchedContent`) is mapped into responses in dozens of files. Adding governance later means touching all of them, in the fork, forever.

Four seams added now cost little, change no behaviour, and turn the enterprise edition into "register a module and override three providers".

## 3. Goals

- One place resolves *who is acting*, for REST, MCP, WebSockets, autopilot and CLI callbacks.
- One place decides *whether an action is allowed*, called from REST routes and the MCP tool executor.
- One place decides *how finding content is presented* (full or redacted), used by every path that returns matched content.
- An enterprise module can be loaded at boot without code changes to the core, and can bring its own tables and migrations.

## 4. Non-goals

- Implementing sign-in, roles, permissions, audit storage or redaction rules. Those are enterprise edition features.
- Changing any response shape or default behaviour in the open-source build.

## 5. Requirements

| # | Requirement | Priority |
|---|---|---|
| R1 | **Actor context.** An `Actor` value (`{ id: string \| null, displayName: string \| null, kind: 'person' \| 'agent' \| 'integration' \| 'system', via: 'header' \| 'proxy' \| 'mcp-token' \| 'internal-key' \| 'autopilot' }`) is resolved once per request and stored in CLS. It is read through `ActorContextService.current()` | MUST |
| R2 | The resolver is a DI token (`ACTOR_RESOLVER`). The default `DefaultActorResolver`: <br>• reads `X-Actor-Name`, exactly as `parseActorName` does today; <br>• marks MCP-token requests as `integration`, using the token name; <br>• marks internal-key requests (CLI) as `system`; <br>• marks autopilot runs as `agent` (`ai-autopilot`) | MUST |
| R3 | With `CLASSIFYRE_ACCESS_MODE=proxy` ([G0](G0-safe-defaults.md)), the default resolver may take the display name from a configured trusted header (default `X-Forwarded-User`, then `X-Auth-Request-User`) | SHOULD |
| R4 | `@ActorName()` keeps working as an adapter over R1. New code uses `@CurrentActor()`. Existing call sites migrate in the same PR where practical | MUST |
| R5 | **Access policy.** A DI token `ACCESS_POLICY` with `check(actor, action, resource?) → { allow: boolean, reason?: string }`. The default `AllowAllPolicy` allows everything | MUST |
| R6 | Every REST route declares its action with `@Access('<area>.<verb>')`, for example `findings.read`, `findings.update`, `sources.run`, `cases.export`, `detectors.manage_code`. A global guard calls the policy with the route's action | MUST |
| R7 | The MCP tool executor (`apps/api/src/mcp-tool-executor.service.ts`) maps every tool to an action and calls the same policy before running it | MUST |
| R8 | A spec fails when a controller route or an MCP tool has no action, in the same style as `mcp-catalog.completeness.spec.ts` | MUST |
| R9 | **Content presenter.** `FindingContentPresenter.present(finding, purpose)` is the single function that returns `matchedContent`, `contextBefore` and `contextAfter`, or their redacted forms. The default returns full content, exactly as today | MUST |
| R10 | Every path that sends matched content outside the process goes through R9. That covers REST DTO mappers, CSV and live-query exports, MCP tool results, case export ([G3](G3-outbound-webhooks-notifications-export.md)), webhook payloads ([G3](G3-outbound-webhooks-notifications-export.md)), entity pages ([G5](G5-entities.md)), the assistant and chat context, and namespace data export. `purpose` is one of `ui`, `export`, `integration`, `ai_context`, `transfer` | MUST |
| R11 | A check fails CI when a DTO mapper assigns `matchedContent` without going through the presenter. The check is a small AST or lint rule over `apps/api/src/**/dto` and the mapper functions | SHOULD |
| R12 | When the presenter (or a policy) serves unredacted content in a mode that asks for it, it records a `content.revealed` domain event ([F1](00-integration-architecture.md#f1-domain-events)). In the default mode nothing is recorded | MUST |
| R13 | **Module loading.** `CLASSIFYRE_EXTENSION_MODULES` lists packages resolved at boot with dynamic `import()`. Each exports a Nest `DynamicModule` that may override `ACTOR_RESOLVER`, `ACCESS_POLICY` and `CONTENT_POLICY`, add controllers, and subscribe to domain events | MUST |
| R14 | The migration runner accepts extra migration directories from extension modules and applies them after core migrations, per tenant schema and in their own `_prisma_migrations`-style table. Core migrations never depend on extension tables | SHOULD |
| R15 | Web: `GET /<ws>/me` returns the resolved actor and capability flags (`canManageCode`, `canExport`, …; all `true` by default). A `useActor()` hook and a `<Can action="…">` component read them, so enterprise builds can hide controls without forking components | SHOULD |
| R16 | The core never imports extension code. Extension packages depend on the core's published types only | MUST |

## 6. Design

### 6.1 Actor context

- Put `ActorContextService` in `apps/api/src/identity/`. It uses the existing global `ClsModule` (`app.module.ts`), next to the namespace keys (`CLS_NAMESPACE_ID`, `CLS_SCHEMA`).
- Populate it in the Fastify request hook that already establishes the namespace context (`namespace/namespace-request.hook.ts`), so namespace and actor are set at the same moment.
- For autopilot and pg-boss workers there is no HTTP request. Wrap job handlers with `runAsActor(actor, fn)`, which enters a CLS context. Agent runs use `{ kind: 'agent', displayName: 'ai-autopilot' }`, matching the existing `decidedBy` convention in `CorrelationPairVerdict`.
- Anything that writes an actor string today (`createdBy`, `addedBy`, `decidedBy`, `reviewedBy`, `triggeredBy`, `verifiedBy`) reads `actor.displayName` in the open-source build. The enterprise module can write stable ids instead without schema changes: the columns are already free text.

### 6.2 Access policy

```ts
export interface AccessPolicy {
  check(actor: Actor, action: AccessAction, resource?: ResourceRef): AccessDecision | Promise<AccessDecision>;
}
export type ResourceRef =
  | { type: 'source' | 'finding' | 'asset' | 'case' | 'inquiry' | 'detector' | 'entity'; id: string }
  | { type: 'namespace'; id: string };
```

- `AccessAction` is a string-literal union kept in `identity/actions.ts`. It is the one catalogue of actions, and the enterprise edition maps roles onto it.
- The global guard reads `@Access()` metadata and calls the policy with the route's action. Resource-level checks (a specific case) happen in services through `accessPolicy.check(...)`, because only the service knows the resource. In the open-source build these calls are no-ops.
- Demo mode stays a separate guard. Access decisions and demo decisions are different questions.

### 6.3 Content presenter

- `identity/finding-content.presenter.ts` exposes `present(finding, purpose)` and `presentMany(findings, purpose)`.
- Start from an inventory. `grep -rln matchedContent apps/api/src` lists 39 files today. Classify each hit as *internal logic* (matching, correlation, identity hashing: leave alone) or *exposure* (DTO mapping, exports, MCP results, assistant context: route through the presenter).
- The embedding and correlation pipelines read content for computation. That is not exposure, and they stay as they are.

### 6.4 Extension modules

- `app.module.ts` builds its imports list from core modules plus `await loadExtensionModules(process.env.CLASSIFYRE_EXTENSION_MODULES)`.
- A missing package logs one error and boots without it. Refusing to boot is the enterprise module's own choice, through a `required` flag.
- Enterprise tables live in the tenant schema under a table prefix (`ee_*`), migrated by the R14 runner. Keeping them out of `schema.prisma` means the core's Prisma client never sees them, so upstream schema changes cannot conflict with them.

## 7. How it connects

- **F1 domain events** ([integration](00-integration-architecture.md)): R12 writes `content.revealed`. Enterprise audit subscribes to *all* domain events, so the audit trail needs no extra hooks in feature code.
- **[G3](G3-outbound-webhooks-notifications-export.md)**: webhook payloads, push messages and case exports call the presenter with `purpose='integration'` or `'export'`. That lets an enterprise policy strip content from anything leaving the instance.
- **[G5](G5-entities.md) / [G6](G6-triage-queue.md) / [G7](G7-outcome-metrics.md)**: decisions (entity merges, triage accept or dismiss, baselines) record `ActorContextService.current()`. The metrics can then separate human from agent work, as the duplicates review already does with `decidedBy`.
- **[G1](G1-python-detector.md)**: `detectors.manage_code` is its own action, so an enterprise policy can restrict who writes Python detectors, independently of who edits a regex.

## 8. Rollout and compatibility

- Behaviour-neutral: no response shape changes, no default changes.
- Ship R1–R2 and R4 first (actor), then R5–R8 (policy), then R9–R12 (presenter). Each is a separate PR with its own completeness spec.
- Document the extension API in `docs/architecture/EXTENSION_SEAMS.md` for the future enterprise team.

## 9. Testing and acceptance

- **Actor:** unit tests for each `via`: header, proxy header, MCP token, internal key, autopilot job. An e2e check that `createdBy` on a new case equals the header value, as today.
- **Policy:** a test module overrides `ACCESS_POLICY` with deny-all, and every REST route returns 403 and every MCP tool refuses. This proves every path consults it (R6–R8).
- **Presenter:** a test policy that redacts everything. Then snapshot the findings list, a finding detail, a CSV export, the MCP `get_finding` result and a case export: no raw `matchedContent` may appear.
- **Extension loading:** a fixture extension module overrides the resolver and adds a controller. Boot passes, and the controller answers inside the namespace URL contract.

## 10. Success measures

- An enterprise prototype implementing OIDC sign-in plus viewer and analyst roles needs **no changes** in `apps/api/src` outside `identity/`. That is the acceptance test for the seams.

## 11. Open questions

- Should autopilot agents act under a configurable service actor (for example `autopilot@<workspace>`) so enterprise roles can bound them? The recommendation is yes, with the default display name `ai-autopilot` unchanged.
