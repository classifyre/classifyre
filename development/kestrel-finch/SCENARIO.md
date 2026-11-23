# Kestrel & Finch Journeys — the scenario

*Source material for a blog post and a product video. Everything here runs on
the dev stack (`README.md` rebuilds it); every number below was measured on it
on 2026-11-23. Screenshots: `docs/reviews/2026-11-23-kestrel-finch-shots/`.*

## The one-line pitch

Two companies merged and kept all their systems. One customer now lives in
five of them. Ten colleagues — and an outside agency — need some of her data,
none of them all of it. Classifyre finds what is where, decides who sees what,
and lets each of them use plain SQL, Excel or Metabase without a copy, a
second warehouse or a ticket.

## The company

**Kestrel & Finch Journeys** is a European tour operator. **Kestrel Reisen**
(Innsbruck; walking and rail holidays in Austria, Germany and Switzerland)
merged in 2024 with **Finch Tours** (Edinburgh; sailing and aurora trips in the
UK and the Nordics). Nobody merged the systems:

| System | Technology | What is in it |
| --- | --- | --- |
| **Kestrel CRM** (HubSpot sync) | PostgreSQL | 189 contacts with e-mail, phone, birthday, Austrian social insurance number (SVNR), marketing consent; deals; sales reps' free-text notes |
| **Finch CRM** (Salesforce export) | Delta tables in S3 | 157 contacts with passport numbers and dietary needs (health data); opportunities. One customer was erased under GDPR Art. 17 — a Delta delete |
| **Wayfarer Club** (loyalty) | Iceberg tables in an Apache Polaris catalog | 186 members with IBANs for refunds, tiers, points |
| **Support desk** | DuckLake | 181 tickets; two agents pasted an AWS key and a live Stripe key into internal notes, customers pasted card numbers and passport numbers |
| **Billing** (legacy) | PostgreSQL that only an ODBC driver reaches | 510 invoices with IBANs; a card vault nobody switched off |

### The traveller we follow

**Margarethe Albrecht**, Innsbruck. Booked hut-to-hut walks with Kestrel and a
Lofoten sailing week with Finch, Falcon tier in the Wayfarer Club, coeliac, and
she said **no** to marketing e-mails at Kestrel. She is spelt
`margarethe.albrecht@…` in Kestrel, `Margarethe.Albrecht@…` in Finch and
`MARGARETHE.ALBRECHT@…` in Wayfarer. Her support ticket asks for gluten-free
meals on the boat and gives her mobile number.

## The people

| Person | Team | Needs | Gets |
| --- | --- | --- | --- |
| Ines Kovač | IT (tenant admin) | to run the platform | everything — and learns that row filters bind admins too |
| Tomasz Wierzbicki | Data platform | to own the five sources | owner of all of them; publishes the shared dataset |
| Henrike Sauer | Privacy office (DPO) | to decide what is sensitive | steward of every source: sets classifications and masks |
| Lukas Brandner | Sales DACH | his customers, to call them | Kestrel contacts and deals **in clear**, DACH rows only, **no SVNR** |
| Sigrid Halvorsen | Sales Nordics | her customers | Finch contacts, Nordic rows only |
| Amélie Fontaine | CRM marketing | how many people, in which systems, who agreed | contacts of both CRMs, **opted-in only**, e-mail **hashed** (joinable), phone last four, no birthday, no IDs |
| Kwame Mensah | Customer care | the tickets, a caller's loyalty tier | ticket bodies with keys and numbers **scrubbed out**; the loyalty table after **asking for access** |
| Olga Lindqvist | Finance | receivables | billing over ODBC; IBAN and card number last four |
| Ravi Iyer | BI | dashboards | bookings tables and the shared dataset in **Metabase** |
| Jonas Eklund | Northlight (outside agency) | campaign counts | one shared dataset, nothing else of the workspace |

## What happens, step by step

1. **Organization and people.** A Keycloak organization *Kestrel & Finch
   Journeys* becomes a Classifyre tenant the moment its first member signs in;
   its `admins` group gets Tenant admin. Groups are nested (`/sales/sales-dach`).
2. **Five sources, five technologies,** one workspace. Scans run the PII and
   secrets detectors over every row and tie each finding to its table and
   column.
3. **Columns classify themselves.** `email`, `phone` → personal; `svnr`,
   `iban`, card numbers → sensitive; the ticket body → secret (it holds keys).
   Henrike adds what no detector can know: a birthday is personal, dietary
   needs are health data, the passport column is sensitive.
4. **Masks follow the classification,** and stewards choose how:
   redacted `****`, last four `••••8281`, hashed `6ad2bb6e9636693b` (equal
   values hash equally, ignoring case, so tables still join), empty `NULL`,
   identifiers removed from free text (`…Mobile [phone].`), hidden, or
   restricted (hidden even from people who read the table unmasked).
5. **Rows follow rules:** region for sales, consent for marketing. The
   *Rows* step warns that `/admins` could query the table but would see
   nothing.
6. **Grants go to groups,** on a whole source or a single table.
7. **Asking instead of waiting:** Kwame requests the loyalty table with a
   reason; Tomasz, its owner, approves for 30 days; it works two seconds later
   and the grant expires on its own.
8. **A shared dataset** for the agency: one SQL over both CRMs and the loyalty
   programme, consent applied, run as the data team. It joins on the real,
   lower-cased e-mail (which only the data team may read) and finds 22
   travellers in both CRMs. The agency gets counts and masked columns, never
   the base tables.
9. **SQL connections** for tools: each person makes their own connection,
   scoped to what they need; the tool signs in as them over TLS. Excel and
   Power BI's ODBC driver, psql and Metabase all see exactly that person's
   tables, masks and rows.
10. **Findings respect the same rule.** A finding's matched value is the data
    itself, so Viewers see `••••` where a query would mask; investigators and
    whoever reads the table in clear see the value.
11. **Every read is logged:** person, channel (app, SQL connection, AI agent),
    connection, and — when it came through the dataset — on the input table's
    activity too, so Tomasz sees that the agency received his data.

## Features this scenario covers

| Area | Feature |
| --- | --- |
| Identity | Organizations as tenants, nested groups, tenant admin, workspace owning group, roles: Viewer, Data consumer, Data reader (masked / unmasked), Workspace admin, owners, stewards, custodians |
| Sources | PostgreSQL, S3 Delta (with a GDPR delete), Iceberg REST (Polaris), DuckLake, ODBC |
| Detection | PII and secrets per column, EU national IDs as sensitive, camelCase CRM columns |
| Governance | Column classification, steward overrides, seven column treatments, row filters by group with a warning for readers without rows, access requests with expiry |
| Query | SQL page, joins across five technologies, masked joins, exports, MCP |
| Sharing | Shared dataset with inherited masks, column lineage, input owners told |
| BI | SQL connections over TLS with SCRAM; psql 18, psqlODBC 18 (Excel/Power BI's driver), pgJDBC in Metabase 0.65 |
| Audit | Reads per person, channel and connection; dataset reads on input tables |
| Safety | 12 attempts to get around the SQL rules refused; finding values follow column masks; value searches closed to people who may not read values |

## Story beats for the post

- **"Who sees Margarethe?"** — the same row through five people's eyes
  (screenshots 01 vs 02: marketing masked vs sales in clear).
- **Consent is a row filter.** She said no; marketing never sees her in Kestrel.
- **Dedup without seeing an address.** Hashes join across CRMs.
- **The erased customer stays erased** (Delta delete, nobody can read her).
- **The agency gets a dataset, not a database.**
- **Two keys in a ticket don't cost the support team every ticket.**
- **The tenant admin sees an empty table** — and that is the point.

## Video outline (≈3 minutes)

| # | Scene | On screen | Line |
| --- | --- | --- | --- |
| 1 | Cold open | Five logos/tech names around one name: Margarethe | "One customer. Five systems. Eleven people who need a piece of her." |
| 2 | Scan | Sources list → scan → columns classified | "First: find what is where." |
| 3 | The DPO decides | Henrike's Columns step: hash, last four, restrict | "The privacy officer decides how each column looks." |
| 4 | Same query, two people | Split screen: Lukas in clear vs Amélie masked | "Same SQL. Different answers. Both correct." |
| 5 | Consent | Amélie's count without Margarethe | "She said no. The filter remembers." |
| 6 | The ticket | Kwame's tickets, `[key]` and `[phone]` in the text | "Two pasted keys don't take the whole column away." |
| 7 | Ask, approve | Request → Tomasz approves → Kwame's query works | "Ask the owner, not the ticket queue." |
| 8 | Agency | Jonas sees one dataset, nothing else | "A dataset, not a database." |
| 9 | Tools | Excel/ODBC list, Metabase dashboard with `****` | "Your tools, the same rules." |
| 10 | Audit | Activity: agency read via dataset, on Tomasz's table | "And everyone can see who read what." |

## Numbers measured on the dev stack

| What | Value |
| --- | --- |
| Rows across the five systems | ~1,900 in 10 tables |
| Scans (PII + secrets, full) | 1–4 min per source |
| A query on one table, as a person (REST) | ~0.7 s |
| The three-system shared dataset | ~1.7 s |
| Excel/ODBC through the gateway | 0.8–2.6 s (8–13 s for the ODBC billing source: each is a Kubernetes Job) |
| Metabase dashboard, 5 cards | 8–12 s |
| Persona checks | 39/39; ODBC client 11/11; Metabase 9/9; finding values 13/13 |

*(Timings are from a laptop running everything at once. Don't put them in
marketing copy.)*

## What the battle test changed

The run found and fixed, among others: columns not classified on realistic
tables (so masks didn't apply by default), ODBC sources not queryable, a shared
dataset silently dropping two inputs, Metabase dashboards refused as "busy",
finding values visible to every Viewer, whole free-text columns hidden for two
pasted keys, sales reps seeing national IDs, hashes that didn't join across
spellings, and admins left with silent empty tables. Details:
`docs/reviews/2026-11-23-battle-test-kestrel-finch.md`.
