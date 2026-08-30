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
