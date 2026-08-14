/**
 * Bounded capture of a child process's output.
 *
 * `stdout += chunk` for the lifetime of a CLI run retains every byte the run
 * ever wrote — for a multi-hour scan of a large corpus that is tens of MB of
 * text held only so that a failure message can quote the end of it, and it is
 * already persisted by RunnerLogStorageService. Retention here is a function of
 * the caps below and of nothing else: not corpus size, not scan duration, not
 * how chatty the CLI's log level happens to be.
 *
 * Two modes, because the two callers want opposite ends of the stream:
 *  - `tail`: keep the most recent output (what a failure message needs).
 *  - `head`: keep the first `maxBytes` and stop (a connection test parses a
 *    JSON line the CLI prints early; a runaway writer must not be able to
 *    inflate the capture behind it).
 */
export type BoundedOutputMode = 'tail' | 'head';

export type BoundedOutputOptions = {
  mode?: BoundedOutputMode;
  maxBytes?: number;
  maxLines?: number;
  /** Single lines longer than this are truncated as they arrive, so one
   * pathological line can never become one pathological allocation. */
  maxLineLength?: number;
};

const DEFAULTS = {
  mode: 'tail' as BoundedOutputMode,
  maxBytes: 256 * 1024,
  maxLines: 400,
  maxLineLength: 8 * 1024,
};

export class BoundedOutput {
  private readonly opts: Required<BoundedOutputOptions>;
  private readonly lines: string[] = [];
  private bytes = 0;
  private droppedLines = 0;
  private overflowed = false;
  /** Trailing fragment of a chunk that did not end on a newline. */
  private partial = '';

  constructor(options: BoundedOutputOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
  }

  append(chunk: string): void {
    if (!chunk) return;
    // Chunk boundaries are arbitrary — a line can be split across two reads —
    // so join the carry-over before splitting.
    const combined = this.partial + chunk;
    const parts = combined.split('\n');
    this.partial = parts.pop() ?? '';
    // A writer that never emits a newline would otherwise grow `partial`
    // without bound, which is the very thing this class exists to prevent.
    if (this.partial.length > this.opts.maxLineLength) {
      this.pushLine(this.partial);
      this.partial = '';
    }
    for (const line of parts) this.pushLine(line);
  }

  private pushLine(raw: string): void {
    if (this.opts.mode === 'head' && this.overflowed) return;

    const line =
      raw.length > this.opts.maxLineLength
        ? `${raw.slice(0, this.opts.maxLineLength)}…[line truncated]`
        : raw;

    if (this.opts.mode === 'head') {
      if (
        this.bytes + line.length > this.opts.maxBytes ||
        this.lines.length >= this.opts.maxLines
      ) {
        this.overflowed = true;
        return;
      }
      this.lines.push(line);
      this.bytes += line.length;
      return;
    }

    this.lines.push(line);
    this.bytes += line.length;
    while (
      this.lines.length > 0 &&
      (this.lines.length > this.opts.maxLines ||
        this.bytes > this.opts.maxBytes)
    ) {
      this.bytes -= this.lines.shift()!.length;
      this.droppedLines += 1;
    }
  }

  /** Flushes any unterminated trailing fragment. Call once at process exit. */
  finish(): void {
    if (this.partial) {
      this.pushLine(this.partial);
      this.partial = '';
    }
  }

  /** True when output was discarded to stay within the caps. */
  get truncated(): boolean {
    return this.droppedLines > 0 || this.overflowed;
  }

  toString(): string {
    const body = this.lines.join('\n');
    if (!this.truncated) return body;
    return this.opts.mode === 'tail'
      ? `…[${this.droppedLines} earlier line(s) omitted — see the run log for the full output]\n${body}`
      : `${body}\n…[output truncated]`;
  }
}
