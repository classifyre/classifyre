-- A link a person drew was stored with the column default, SYSTEM_CATALOG, so the
-- app said a platform reported it.
UPDATE "edges" SET "method" = 'MANUAL'::"EdgeMethod" WHERE "origin" = 'MANUAL'::"EdgeOrigin";
