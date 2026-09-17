-- Scrub scan error text stored before secret redaction shipped.
--
-- Runner error payloads used to embed the full job log
-- (`error_details.output`, observed at 4+ MB on a real failed scan) and
-- driver/notebook errors verbatim, so live credentials echoed into those
-- streams were persisted and rendered in the UI. The CLI now redacts before
-- sending and the API redacts and bounds before storing, so clearing the
-- historical values removes the exposure.
--
-- NULL (not '') so readers keep treating "no error" uniformly; the scan
-- status columns are untouched, only the free-text error payloads.
UPDATE "runners" SET "error_message" = NULL, "error_details" = NULL WHERE "error_message" IS NOT NULL OR "error_details" IS NOT NULL;
UPDATE "runner_assets" SET "error_message" = NULL WHERE "error_message" IS NOT NULL;
UPDATE "sources" SET "last_error_message" = NULL WHERE "last_error_message" IS NOT NULL;
