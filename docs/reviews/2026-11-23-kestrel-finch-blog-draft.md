# Blog draft — "One traveller, five systems, ten colleagues"

*Draft for the blog (apps/blog, Guides). Follows the positioning notes: no speed
claims, hashing is pseudonymisation (never "anonymisation"), nothing for sale,
the company and people are not labelled as made-up. Screenshots are in
`docs/reviews/2026-11-23-kestrel-finch-shots/`. Slug idea:
`/blog/articles/one-customer-many-crms-masked-sql` (DE:
`/de/blog/articles/ein-kunde-viele-crms-maskiertes-sql`).*

---

## Title options

- One traveller, five systems, ten colleagues: governed SQL across three CRMs
- What does your marketing team see when it queries the CRM? (And your agency? And your BI tool?)
- After the merger: two CRMs, one customer, and who gets to see her phone number

**Description:** Two merged companies, two CRMs, a loyalty programme, a support
desk and a billing system that only speaks ODBC. One customer is in all five.
Here is how ten colleagues query her data with plain SQL, from the browser,
Excel and Metabase — and what each of them actually sees.

---

## Meet Margarethe

Margarethe Albrecht lives in Innsbruck. Over the years she booked hut-to-hut
walks with **Kestrel Reisen**, a Lofoten sailing week with **Finch Tours**, and
collected Falcon status in the **Wayfarer Club**. When Kestrel and Finch merged
into **Kestrel & Finch Journeys**, nobody merged the systems:

| System | Where it lives | How Margarethe is spelt |
| --- | --- | --- |
| Kestrel CRM (HubSpot sync) | PostgreSQL | `margarethe.albrecht@alpenmail.example.com`, opted out of marketing |
| Finch CRM (Salesforce export) | Delta tables in S3 | `Margarethe.Albrecht@…`, passport number, "Coeliac (gluten-free)" |
| Wayfarer Club | Iceberg, Apache Polaris catalog | `MARGARETHE.ALBRECHT@…`, IBAN for refunds |
| Support desk | DuckLake | a ticket about gluten-free meals, with her mobile number |
| Billing | legacy PostgreSQL, only via ODBC | invoices, and a card number in a card vault nobody switched off |

Ten people need some of this. None of them needs all of it.

## Step 1: find out what is where

We pointed Classifyre at the five systems and scanned them. Scans classify
*columns*, not just files: `email` and `phone` come back as personal data,
`svnr` (the Austrian social insurance number) and `iban` as sensitive, the
support tickets' `body` as secret — two agents pasted an AWS key and a live
Stripe key into internal notes.

Some things no detector knows, and a data protection officer has to say:
a date of birth is personal data, `Dietary_Requirements__c` is health data
(GDPR Art. 9), the passport column is sensitive. Henrike, the DPO, is the
steward of every source; she sets those in the Columns step, and every change
lands in the audit trail.

*(screenshot: 09-steward-governance)*

## Step 2: one rule per column, one rule per row

Five ways a column can look to someone who may not read it in clear:

| Mask | Margarethe's value becomes | Why |
| --- | --- | --- |
| redact | `****` | names, for most readers |
| last four | `••••8281` | phone and IBAN: enough to say "the card ending in…" |
| hash | `6ad2bb6e9636693b` | the same e-mail gives the same hash in every system, so marketing can count one traveller across both CRMs without seeing an address (pseudonymisation, not anonymisation) |
| empty | `NULL` | date of birth |
| hidden | the column is not there | national IDs, passports |

And rows: the DACH sales team sees DACH customers; marketing sees only people
who said yes — the consent flag *is* the row filter. Margarethe said no in
Kestrel. Marketing never sees her there.

## Step 3: the same query, four people

`SELECT first_name, email, phone, birth_date, region FROM kestrel_crm.crm.contacts`

- **Lukas, sales DACH** — Margarethe in clear, because she is his customer. *(screenshot: 02-sales-sql-clear)*
- **Amélie, marketing** — 114 opted-in contacts, hashed e-mails, last four of the phone, no birthday, no social insurance number; the page says which columns are masked and why. *(screenshot: 01-marketing-sql-masked)*
- **Sigrid, sales Nordics** — "the table does not exist or you cannot query it." It is not her CRM.
- **Kwame, customer care** — asks for the loyalty table ("callers want to know their tier"); Tomasz, its owner, approves for 30 days; two seconds later Kwame sees Falcon, 43,986 points, and still no name or e-mail.

What none of them can do: `WHERE email LIKE '%@%'` (it counts zero — filters
run on the masked value), `read_parquet('s3://…')`, `postgres_scan(…)`,
naming the hidden column, or reading it through a row value. We tried twelve
ways; all were refused.

## Step 4: an agency, without the keys to the house

Northlight, the campaign agency, needs "how many consented travellers per
region, how many in both CRMs, which loyalty tier". Tomasz shares a **dataset**:
one query over both CRMs and the Wayfarer Club, consent applied, read as the
data team's group. The agency gets *Data consumer* plus that one dataset:
in the app they see exactly one table, and nothing else of the workspace.

The dataset joins the systems on the real, lower-cased e-mail — which only the
data team may read — so it finds 22 travellers in both CRMs where marketing's
hash join, which is case-sensitive, finds 18. The agency gets the counts, not
the addresses. *(screenshot: 04-agency-dataset)*

The owners of the input tables see, on their own table's activity, that the
agency read their data — *through the dataset*.

## Step 5: Excel, Power BI, Metabase

BI tools connect over the PostgreSQL protocol: each person makes a SQL
connection for the tables they need, and the tool signs in as that person.

- **Excel / Power BI (psqlODBC):** Amélie's navigator lists exactly her three tables; `svnr` is not a column; `DELETE` is refused.
- **psql:** `\d+` shows `Masked (hash)` next to the column.
- **Metabase:** Ravi's dashboard — travellers by region, loyalty tiers, revenue across both CRMs, departures per month — and a table card that shows `****` where the e-mail would be. *(screenshot: 08-metabase-dashboard)*
- **Billing over ODBC, through the gateway, to a BI tool:** Olga in finance sees receivables by currency and cards as `••••1111`.

Every read — browser, ODBC, Metabase — is in the activity log with the person,
the channel and the connection.

## What we fixed on the way

*(Optional section — engineering honesty reads well, keep it short.)*

Running this end to end found things a unit test does not:

- Tables wider than two columns weren't tied to their columns when scanned, so nothing was masked by default. Now every finding carries its column.
- Salesforce-style column names (`MobilePhone`) are now understood like `mobile_phone`.
- ODBC sources could not be queried after an engine hardening; they can again.
- A dataset whose owning group was row-filtered out of an input shared without complaint; now sharing stops and says why.
- Metabase dashboards that open several sessions at once were turned away by the gateway; they now wait their turn.
- And the *Data consumer* role exists because the agency needed it.

## Closing

Classifyre is open source (Apache-2.0). Questions? Get in touch —
contact@classifyre.com. Writing to us doesn't start a sales process.

---

### Notes for whoever finishes this post

- Don't claim timings in the post.
- Be careful with "masking": say what each mask shows; never "anonymised".
- The *findings* page still shows detected values to Viewers (see the battle-test report, blocker). Don't write "nobody without permission sees the number" until that is decided; the agency is safe because of *Data consumer*.
- A German version needs `DSGVO`, `Datenmaskierung`, `Pseudonymisierung`, `Zeilenfilter` in the copy (topic slugs in `apps/blog/lib/topic-slugs.json`).
