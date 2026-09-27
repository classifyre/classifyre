-- A watch's settings on a case (auto-add on or off) get their own timeline
-- entry. They were written as CASE_UPDATED, which the timeline could only show
-- as "Case updated", saying neither which watch nor what changed.
--
-- `ADD VALUE IF NOT EXISTS` is idempotent and legal inside a transaction as long
-- as the new value is not used in it, so it replays safely across every tenant
-- schema.
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'INQUIRY_SETTINGS_UPDATED';
