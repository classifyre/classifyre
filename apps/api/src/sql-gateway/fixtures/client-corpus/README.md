# Client statement corpus

What BI tools and drivers send to the SQL gateway, statement by statement, so
CI replays it against a real PGlite session without a cluster
(`../../pg-session.integration.spec.ts`, *client corpus*;
docs/prd/BIC-bi-client-compatibility.md §6).

One file per client and version: `<client>-<version>.sql`. Each statement
follows a line

    -- @@ <kind> <label> [rows>=N]

- `kind` is `session` (SET, BEGIN, COMMIT, SHOW), `catalog` (answered by
  PGlite), `data` (runs as a query job: the spec checks the gateway hands it to
  the data runner) or `refused` (must fail).
- `rows>=N` asks a `catalog` statement for at least N rows.

Names are those of the spec's fixture workspace: database `lab`, one schema
`"shop.public"` with the table `orders` (id, customer, amount, created).
Rewrite captured names to these; never commit values a person typed.

**Adding a client or version** (BIC §6.4): run the smoke with the gateway's
trace on (`SQL_GATEWAY_TRACE=true`), take the statements from the gateway log,
add them here as a new file, run the spec, fix what fails. The trace cuts
statements at 300 characters; long catalog queries are taken from the driver's
source or a packet capture instead.
