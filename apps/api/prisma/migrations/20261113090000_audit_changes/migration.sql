-- What a change changed, where the values are not secret (governance, GOV):
-- [{field, from, to}], shown in Activity next to the field names.
ALTER TABLE "audit_events" ADD COLUMN IF NOT EXISTS "changes" JSONB;
