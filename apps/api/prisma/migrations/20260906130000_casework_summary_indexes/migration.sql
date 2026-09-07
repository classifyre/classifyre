-- Indexes the casework summary on the dashboard needs.
--
-- `cases` already carried an index on created_at but not updated_at, while both
-- the case list and the new summary order by updated_at desc. On a small case
-- table that is a cheap sort; on a workspace that has been running for a year it
-- is a full scan on every dashboard load.
--
-- `case_leads` had only ([case_id, status]). Counting leads awaiting review
-- across every case has no case id to lead with, so that composite cannot serve
-- it and Postgres falls back to a sequential scan of every lead ever proposed.
CREATE INDEX IF NOT EXISTS "cases_updated_at_idx" ON "cases" ("updated_at");
CREATE INDEX IF NOT EXISTS "case_leads_status_idx" ON "case_leads" ("status");
