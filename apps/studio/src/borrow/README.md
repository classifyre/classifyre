# Borrowing components from `apps/web` and `apps/blog`

Product videos should show real Classifyre UI. Most shared components live in `packages/ui` (and `packages/case-board` for case views) and can be imported directly.

Some useful components live only inside `apps/web` or `apps/blog` (for example, the landing page hero, source setup cards, or action toolbars). This folder lets videos import them in place without copying code.

## How it works

Files inside `apps/web` and `apps/blog` use their own `@/` path aliases and `tsconfig.json`. Here we load them with `require.context` (which the bundler resolves while keeping Studio's TypeScript check clean) and export typed wrappers:

```ts
const landing = require.context("../../../blog/components/landing", false, /hero\.tsx$/);
export const { Hero } = landing<{ Hero: ComponentType<{ locale: "en" | "de" }> }>("./hero.tsx");
```

`remotion.config.ts` scopes each app's `@/` alias to files inside that app, and `src/studio.css` tells Tailwind to scan those components so their classes are compiled.

Import shared borrowed components from `web.ts` and `blog.ts`:

```ts
import { Hero } from "../../../src/borrow/blog";
import { SamplingCard, StickyActionToolbar } from "../../../src/borrow/web";
```

Add new borrowed components here rather than directly inside a single video folder.

## Stand-in modules

A few app modules depend on Next.js runtime hooks or build-time values that do not exist in Remotion. They are swapped via per-app alias overrides:

| File | Replaces | Why |
| --- | --- | --- |
| `web-translation.ts` | `apps/web/hooks/use-translation.ts` | Reads English strings directly from the web app's dictionary (`webText`) instead of fetching locale settings from the API. |
| `blog-finding-tags.ts` | `apps/blog/components/finding-tags.ts` | Rotates labels by Remotion frame instead of `setInterval`. |
| `blog-software-version.ts` | `@workspace/ui/lib/software-version` (in blog imports) | Avoids showing `-SNAPSHOT` versions between releases. |

## What can be borrowed (and what cannot)

- **Can be borrowed:** pure prop-driven components that only import React, `@workspace/ui`, the translation hook, and pure helpers from their app's `lib/` (for example `sampling-card.tsx`, `schedule-card.tsx`, `sticky-action-toolbar.tsx`, `stepper-nav.tsx`).
- **Cannot be borrowed directly:** components that call Next.js router hooks or fetch API data themselves (for example `sources-table.tsx`, `app-sidebar.tsx`, or data-fetching pages). For those screens, prefer capturing the real running app with Playwright (`PLAYBOOK.md`, Section 8), or extract the presentation part into `packages/ui` first.

Remember that CSS animations, transitions, and `setInterval` inside borrowed components do not render properly in Remotion. Disable wall-clock animations in your scene CSS and drive motion from the frame.
