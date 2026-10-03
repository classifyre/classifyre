-- The glossary's approval stamp is named for what it is. `verified_*` dates
-- from the flat glossary, where a term was verified or not; since SL1 a term
-- has a status and these columns record who approved it and when.
ALTER TABLE "glossary_terms" RENAME COLUMN "verified_at" TO "approved_at";
ALTER TABLE "glossary_terms" RENAME COLUMN "verified_by" TO "approved_by";

-- The "we classified your terms" notice is gone: existing terms were migrated
-- in place and there is nothing left for an operator to acknowledge.
ALTER TABLE "instance_settings" DROP COLUMN IF EXISTS "glossary_kind_banner_dismissed_at";
