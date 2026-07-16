-- Per-detector outcomes, so "the detector found nothing" can be told apart
-- from "the detector crashed".
--
-- Finding reconciliation used to resolve any OPEN finding whose runnerId was
-- stale on an asset this run touched, reasoning that the asset was scanned so
-- every detector must have re-reported. A detector that raised produces no
-- findings, which was indistinguishable from a clean scan — so a crashing
-- detector silently resolved all of its own prior findings, and adding a
-- detector could resolve another detector's still-valid ones.
--
-- Existing rows get NULL, which authorises no resolution at all. Reconciliation
-- for those assets resumes once they are rescanned by a CLI that reports
-- outcomes.

ALTER TABLE "runner_assets" ADD COLUMN "detector_outcomes" JSONB;
