import type { Source } from '@prisma/client';

/**
 * Replace a CUSTOM source's notebook cells with a description of them.
 *
 * Reading a source used to inline the entire notebook — the whole connector
 * program, many kilobytes of Python — on every read, including the reads that
 * only wanted the variables, the schedule or the name. The editor has its own
 * endpoint (`GET /sources/{id}/notebook`) and every other caller was paying for
 * a payload it discarded; for an agent, it was paying in context window.
 *
 * `cellCount` survives because it is the only part of the notebook a summary
 * view renders, and `cellsOmitted` says the absence is deliberate rather than
 * an empty notebook — which is the difference between "nothing to show" and
 * "we lost your connector".
 */
export function summarizeNotebook<T extends Pick<Source, 'config'>>(
  source: T,
): T {
  const config = source.config as Record<string, any> | null;
  const notebook = config?.required?.notebook;
  if (!notebook || !Array.isArray(notebook.cells)) return source;
  return {
    ...source,
    config: {
      ...config,
      required: {
        ...config.required,
        notebook: {
          revision: notebook.revision ?? 1,
          cellCount: notebook.cells.length,
          cellsOmitted: true,
        },
      },
    },
  };
}

/**
 * Undo {@link summarizeNotebook} on the way back in.
 *
 * `summarizeNotebook` makes a read cheap, but it also makes the read's output
 * an invalid input: `{ revision, cellCount, cellsOmitted: true }` is not a
 * notebook and the CUSTOM schema rejects it. Callers do read-modify-write —
 * that is how a variable, a schedule or a detector list is changed — so a read
 * shape that cannot be written back turns every such edit into a validation
 * error whose message says nothing about notebooks.
 *
 * The marker is treated as "leave the notebook alone": the stored cells are
 * put back. A payload carrying real cells is passed through untouched, so
 * editing the notebook through this endpoint still works.
 */
export function restoreOmittedNotebook<T>(incoming: T, stored: unknown): T {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return incoming;
  }
  const next = incoming as Record<string, any>;
  const notebook = next.required?.notebook;
  if (!notebook || notebook.cellsOmitted !== true) return incoming;

  const storedNotebook = (stored as Record<string, any> | null)?.required
    ?.notebook;
  if (!storedNotebook || !Array.isArray(storedNotebook.cells)) return incoming;

  return {
    ...next,
    required: { ...next.required, notebook: storedNotebook },
  } as T;
}
