-- Inquiry ↔ Case becomes many-to-many via case_inquiries.
CREATE TABLE "case_inquiries" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "inquiry_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_inquiries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "case_inquiries_case_id_inquiry_id_key" ON "case_inquiries"("case_id", "inquiry_id");
CREATE INDEX "case_inquiries_inquiry_id_idx" ON "case_inquiries"("inquiry_id");

ALTER TABLE "case_inquiries"
    ADD CONSTRAINT "case_inquiries_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "case_inquiries"
    ADD CONSTRAINT "case_inquiries_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill existing 1:1 links.
INSERT INTO "case_inquiries" ("id", "case_id", "inquiry_id")
SELECT gen_random_uuid(), "case_id", "id" FROM "inquiries" WHERE "case_id" IS NOT NULL;

-- Drop the old single-case column.
DROP INDEX IF EXISTS "inquiries_case_id_idx";
ALTER TABLE "inquiries" DROP CONSTRAINT IF EXISTS "inquiries_case_id_fkey";
ALTER TABLE "inquiries" DROP COLUMN "case_id";
