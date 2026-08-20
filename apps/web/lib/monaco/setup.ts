"use client";

/**
 * Point Monaco at the copy we ship instead of a CDN.
 *
 * By default `@monaco-editor/react` loads the editor from cdn.jsdelivr.net at
 * runtime. That quietly fails in the two places this product actually runs:
 * the desktop app, which serves a static export over `app://` with no internet
 * assumption, and air-gapped clusters. The failure mode is not an error but a
 * silent downgrade to the plain-textarea loading state -- survivable for a JSON
 * field, not survivable for a notebook.
 *
 * Importing `monaco-editor` directly also pins the editor to the lockfile
 * rather than to whatever the CDN is serving today.
 */

import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { registerPythonCompletions } from "./python-completions";

let configured = false;

/**
 * Monaco runs its *language services* -- JSON schema validation, TypeScript
 * type-checking -- in web workers, and asks the host to construct them. Every
 * portable way to do that is bundler-specific (`?worker` is Vite, a plugin is
 * webpack), and this app is built by Next for the server target and by Vite for
 * component tests, so no single spelling works everywhere.
 *
 * It does not need to. Python has no worker-backed language service: it is
 * tokenized by a Monarch grammar on the main thread, so cells get full
 * highlighting, editing, undo and selection either way. The one thing given up
 * is schema validation inside the JSON config editor, which already reports
 * parse errors itself.
 *
 * So the host hands back an inert worker. Monaco's language services find
 * nobody home and stay quiet, instead of throwing on every keystroke.
 */
function createInertWorker(): Worker {
  const blob = new Blob([""], { type: "text/javascript" });
  return new Worker(URL.createObjectURL(blob));
}

export function configureMonaco(): void {
  if (configured || typeof window === "undefined") return;
  configured = true;

  (self as unknown as Record<string, unknown>).MonacoEnvironment = {
    getWorker: createInertWorker,
  };

  loader.config({ monaco });

  // Registered against the same instance the loader was handed, so cells
  // get SDK completions from the first keystroke.
  registerPythonCompletions(
    monaco as unknown as Parameters<typeof registerPythonCompletions>[0],
  );
}

// Configured on import, not in an effect. `loader.config` has to win the race
// against the first <Editor> mount: an effect runs *after* render, by which
// time the loader has already started fetching from its default CDN path. Any
// module that renders an editor imports this one, so the configuration is in
// place before the component exists.
configureMonaco();

export { monaco };
