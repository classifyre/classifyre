import { app } from 'electron';
import path from 'path';
import fs from 'fs';

export interface SessionState {
  /** Namespace ids that were running, in the order they were opened. */
  openIds: string[];
  /** Active tab id, or '__selector__' when the picker was showing. */
  activeTabId: string | null;
}

// Remembers which workspaces were running (and which tab was active) so the
// next launch can bring the whole session back. Saves are suppressed during
// teardown paths (quit, window close without background mode) — those close
// every workspace, and persisting that would make every restart start empty.
export class SessionStore {
  private filePath: string;
  private suppressed = false;

  constructor() {
    const base = process.env['CLASSIFYRE_DATA_DIR'] || app.getPath('userData');
    this.filePath = path.join(base, 'session.json');
  }

  load(): SessionState {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as Partial<SessionState>;
      return {
        openIds: Array.isArray(parsed.openIds)
          ? parsed.openIds.filter((id): id is string => typeof id === 'string')
          : [],
        activeTabId: typeof parsed.activeTabId === 'string' ? parsed.activeTabId : null,
      };
    } catch {
      return { openIds: [], activeTabId: null };
    }
  }

  save(state: SessionState): void {
    if (this.suppressed) return;
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(state, null, 2));
    } catch (err) {
      console.error('Failed to save session state:', err);
    }
  }

  /** Stops persisting state changes (teardown is about to close everything). */
  suppress(): void {
    this.suppressed = true;
  }

  /** Re-enables saves (window was closed but the app lives on). */
  resume(): void {
    this.suppressed = false;
  }
}
