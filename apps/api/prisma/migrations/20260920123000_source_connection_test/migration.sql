-- An asynchronous connection test needs somewhere to leave its answer
-- (GENESIS field report P2). On Kubernetes a test pod can wait minutes to be
-- scheduled, and the synchronous endpoint held the HTTP request open the whole
-- time -- 422.5 s in the field, which fails behind any ingress with a 60 s
-- timeout.
--
-- On the source row rather than in API memory, so the answer survives a
-- restart and is visible from whichever replica the poll lands on.
ALTER TABLE "sources" ADD COLUMN IF NOT EXISTS "connection_test" JSONB;
