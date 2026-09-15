-- Atomic one-shot dry-run binding for out-of-scope retires.
--
-- The startRetire pre-check (no earlier retire from this dry run, no other
-- ACTIVE retire on this detector) can race a concurrent startRetire: both
-- reads see nothing, both create. These partial unique indexes make the
-- database the winner of that race; the service maps the P2002 back to the
-- same 409 the pre-check would have raised.
--
-- The from-operation binding covers only rows that burn the dry run — rows
-- that changed something, plus rows still running. A CANCELLED/FAILED retire
-- with zero rows changed burned nothing, so it leaves the index (and the dry
-- run stays reusable). NULL fromOperationId rows (dry runs) never conflict:
-- distinct NULLs are not equal.
CREATE UNIQUE INDEX "finding_bulk_operations_retire_from_op_uniq"
  ON "finding_bulk_operations" ((filters ->> 'fromOperationId'))
  WHERE kind = 'RETIRE_OUT_OF_SCOPE'
    AND (filters ->> 'mode') = 'retire'
    AND (filters ->> 'fromOperationId') IS NOT NULL
    AND (changed > 0 OR status IN ('PENDING', 'RUNNING'));

-- At most one ACTIVE retire walks a detector at a time. Completed retires
-- leave the predicate, so a later dry run + retire for the same detector is
-- unaffected (the from-operation binding above still forbids reusing one dry
-- run twice).
CREATE UNIQUE INDEX "finding_bulk_operations_retire_detector_active_uniq"
  ON "finding_bulk_operations" ((filters #>> '{plan,detectorId}'))
  WHERE kind = 'RETIRE_OUT_OF_SCOPE'
    AND (filters ->> 'mode') = 'retire'
    AND status IN ('PENDING', 'RUNNING');
