// Support for dynamic `[id]` routes under a Next.js static export (the desktop
// build). A static export cannot enumerate runtime ids, so each dynamic segment
// emits a single placeholder shell whose directory is DYNAMIC_ID_SENTINEL. The
// Electron protocol handler serves that shell for any real id, and the page
// recovers the real id from the URL at runtime via `useRouteId`.
//
// `generateStaticParams` cannot be exported from a "use client" page, so it is
// declared in the `[id]` **layout** (a server component), which covers every
// page under that segment:
//
//   // app/.../[id]/layout.tsx  (server component)
//   import { dynamicIdParams } from "@/lib/dynamic-route";
//   export function generateStaticParams() {
//     return dynamicIdParams();
//   }

export const DYNAMIC_ID_SENTINEL = "__id__";

export function dynamicIdParams(): Array<{ id: string }> {
  return [{ id: DYNAMIC_ID_SENTINEL }];
}
