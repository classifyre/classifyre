# Borrowing from the apps

A video films the product's own components. Most of them are in
`packages/ui` and `packages/case-board` and are imported the ordinary way. Some
exist only inside an app, `apps/web` or `apps/blog`, and are still worth
filming: the landing page's hero, the source form's sampling and schedule
cards, the bar a form ends in. This folder is what lets a video import those
where they live, without a copy and without moving them first.

## How

Another app's file is written against that app: its `@/…` imports mean *its*
root, and it is checked against *its* tsconfig. So a video takes it with
`require.context`, which the bundler follows and the type checker does not, and
says what it expects to get:

```ts
const landing = require.context("../../../blog/components/landing", false, /hero\.tsx$/);
export const { Hero } = landing<{ Hero: ComponentType<{ locale: "en" | "de" }> }>("./hero.tsx");
```

`remotion.config.ts` gives each app its own `@` (it applies to imports made
from files under that app and nowhere else), and `src/studio.css` tells
Tailwind to read the apps' components, so that their classes exist.

What has been borrowed so far is in `web.ts` and `blog.ts`, typed, for every
video to import:

```ts
import { Hero } from "../../../src/borrow/blog";
import { SamplingCard, StickyActionToolbar } from "../../../src/borrow/web";
```

Add the next one there rather than in a video.

## Stand-ins

A few modules cannot run outside the app they belong to. Each has a stand-in
here, swapped in by the same per-app rule, and each says why at its top:

| File | Stands in for | Because |
|------|---------------|---------|
| `web-translation.ts` | `apps/web/hooks/use-translation.ts` | The app reads its language from settings the API serves. A video speaks English, out of the app's own dictionary (`webText` gives a video the same wording for the chrome it draws itself). |
| `blog-finding-tags.ts` | `apps/blog/components/finding-tags.ts` | The landing page rotates labels on a `setInterval`; here they rotate by frame. |
| `blog-software-version.ts` | `@workspace/ui/lib/software-version`, as the blog reads it | Between releases a checkout's version is a `-SNAPSHOT` no image exists for; the published site shows a release, or `latest`. |

## What can be borrowed, and what cannot

A component can be borrowed when everything it needs arrives as props: it
imports React, `@workspace/ui`, the translation hook and pure helpers from its
app's `lib/`. `sampling-card.tsx`, `schedule-card.tsx`, `case-details-form.tsx`,
`sticky-action-toolbar.tsx` and `stepper-nav.tsx` are like that.

A component that asks the router where it is, or fetches its own rows from the
API (`sources-table.tsx`, `findings-table.tsx`, `inquiry-form.tsx`,
`app-sidebar.tsx`), cannot: there is no router and no API in a render. For
those the README's first rule still holds. Split the part that draws from the
part that fetches, move the drawing part to `packages/ui`, and film that. Until
then a video builds the page out of the same `@workspace/ui` parts and the
app's own dictionary, and says so in its own notes.

Wall-clock motion (CSS animations, transitions, intervals) in a borrowed
component does not render. Switch it off in the video's own stylesheet and
move what should move from the frame.
