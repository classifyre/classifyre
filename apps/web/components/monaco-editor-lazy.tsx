"use client";

// Isolates the `@monaco-editor/react` + `monaco-editor` import behind a
// module boundary that callers only ever reach via `next/dynamic(..., {
// ssr: false })`. `monaco-editor` references `window` at module-evaluation
// time, so if this ever ends up statically imported into a server-rendered
// chunk, the page 500s with `ReferenceError: window is not defined`.
import "@/lib/monaco/setup";

export { default } from "@monaco-editor/react";
