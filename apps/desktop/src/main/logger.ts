import { app } from 'electron';
import fs from 'fs';
import path from 'path';

// A packaged GUI app has no attached terminal, so everything written to
// stdout/stderr (main-process console.* AND the piped API child output) is
// discarded — which is why a failed startup left users with an error
// dialog but no way to see WHY. This module tees both streams to a rotating
// file in userData/logs so the log is always available (and referenced in
// error messages). Launch failures can then be diagnosed from the log alone.

// Rotate once the active log passes this size, keeping only one previous file,
// so a long-lived install stays bounded at ~2×MAX regardless of how chatty the
// API children are.
const MAX_LOG_BYTES = 5 * 1024 * 1024;

let logStream: fs.WriteStream | null = null;
let logFilePath: string | null = null;
let prevLogFilePath: string | null = null;
let bytesWritten = 0;
let rotating = false;

export function getLogFilePath(): string | null {
  try {
    return path.join(app.getPath('userData'), 'logs', 'main.log');
  } catch {
    return null;
  }
}

// Rotate mid-session, not just at startup — a desktop app that stays open for
// days would otherwise grow main.log without bound (the startup-only size
// check never fires while running). Renaming by path is safe on POSIX: the
// ended stream's fd keeps flushing to the renamed inode while the new stream
// opens a fresh file.
function rotateIfNeeded(): void {
  if (rotating || bytesWritten < MAX_LOG_BYTES || !logFilePath || !prevLogFilePath) return;
  rotating = true;
  try {
    const old = logStream;
    logStream = null;
    old?.end();
    fs.renameSync(logFilePath, prevLogFilePath);
    logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
    bytesWritten = 0;
  } catch {
    // Rotation is best-effort (e.g. Windows won't rename an open file). Make
    // sure a usable stream remains so logging keeps working either way.
    if (!logStream && logFilePath) {
      try {
        logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
        bytesWritten = 0;
      } catch {
        // give up on file logging; console still works
      }
    }
  } finally {
    rotating = false;
  }
}

export function initFileLogging(): string | null {
  if (logStream) return getLogFilePath();
  try {
    const logsDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    logFilePath = path.join(logsDir, 'main.log');
    prevLogFilePath = path.join(logsDir, 'main.prev.log');

    // Rotate a large log left over from the previous run before appending.
    try {
      if (fs.statSync(logFilePath).size > MAX_LOG_BYTES) {
        fs.renameSync(logFilePath, prevLogFilePath);
      }
    } catch {
      // no existing log yet
    }

    logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
    bytesWritten = 0;
    logStream.write(
      `\n===== Classifyre ${app.getVersion()} started ${new Date().toISOString()} =====\n`,
    );

    // Tee stdout/stderr into the log while preserving the original write (so a
    // dev run launched from a terminal still prints normally).
    for (const channel of ['stdout', 'stderr'] as const) {
      const stream = process[channel];
      const original = stream.write.bind(stream);
      stream.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
        try {
          const data = chunk as string | Buffer;
          logStream?.write(data);
          bytesWritten += typeof data === 'string' ? Buffer.byteLength(data) : data.length;
          rotateIfNeeded();
        } catch {
          // never let logging break the app
        }
        return (original as (...args: unknown[]) => boolean)(chunk, ...rest);
      }) as typeof stream.write;
    }

    return logFilePath;
  } catch (err) {
    // Logging must never crash startup.
    console.error('Failed to initialise file logging:', err);
    return null;
  }
}
