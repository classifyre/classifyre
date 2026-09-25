/**
 * One op in a batch was refused. The op's writes roll back to its savepoint,
 * the rest of the batch carries on, and the client gets `reason` to show.
 *
 * Anything else thrown while applying an op is unexpected and rolls back the
 * whole batch.
 */
export class BoardOpRejected extends Error {
  constructor(
    message: string,
    readonly code:
      | 'NOT_FOUND'
      | 'STALE'
      | 'INVALID'
      | 'ALREADY_ON_BOARD'
      | 'READ_ONLY_KIND'
      | 'CONFLICT' = 'INVALID',
    readonly current?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'BoardOpRejected';
  }
}
