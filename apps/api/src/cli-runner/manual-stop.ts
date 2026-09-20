/**
 * The error message a run carries when an operator stopped it.
 *
 * A stop is now its own terminal status (`RunnerStatus.STOPPED`), so this is
 * the human-readable reason rather than the marker anything branches on. It
 * stays exported because runs stopped before that status existed are ERROR
 * rows carrying exactly this text, and the scheduler still has to read them as
 * decisions rather than failures.
 */
export const MANUAL_STOP_MESSAGE = 'Manually stopped';
