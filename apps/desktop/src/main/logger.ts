import { app } from 'electron';
import fs from 'fs';
import path from 'path';

// A packaged GUI app has no attached terminal, so everything written to
// stdout/stderr (main-process console.* AND the piped API child output) is
// discarded — which is why a failed workspace open left users with an error
// dialog but no way to see WHY. This module tees both streams to a rotating
// file in userData/logs so the log is always available (and referenced in
// error messages). Launch failures can then be diagnosed from the log alone.

let logStream: fs.WriteStream | null = null;

export function getLogFilePath(): string | null {
  try {
    return path.join(app.getPath('userData'), 'logs', 'main.log');
  } catch {
    return null;
  }
}

export function initFileLogging(): string | null {
  if (logStream) return getLogFilePath();
  try {
    const logsDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const logFile = path.join(logsDir, 'main.log');

    // Keep one previous log around; rotate once the active file passes ~5 MB so
    // a long-lived install doesn't grow it without bound.
    try {
      if (fs.statSync(logFile).size > 5 * 1024 * 1024) {
        fs.renameSync(logFile, path.join(logsDir, 'main.prev.log'));
      }
    } catch {
      // no existing log yet
    }

    logStream = fs.createWriteStream(logFile, { flags: 'a' });
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
          logStream?.write(chunk as string | Buffer);
        } catch {
          // never let logging break the app
        }
        return (original as (...args: unknown[]) => boolean)(chunk, ...rest);
      }) as typeof stream.write;
    }

    return logFile;
  } catch (err) {
    // Logging must never crash startup.
    console.error('Failed to initialise file logging:', err);
    return null;
  }
}
