-- Replace inquiry_matches with two counter columns on inquiries.
-- match_count  = total OPEN findings currently matching (recomputed on each scan/rematch)
-- new_match_count = delta since user last pressed "seen" (incremented on scan, reset on seen/rematch)

ALTER TABLE "inquiries" ADD COLUMN "match_count"     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "inquiries" ADD COLUMN "new_match_count" INTEGER NOT NULL DEFAULT 0;

DROP TABLE "inquiry_matches";
