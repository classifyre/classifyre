-- Glossary stewards become people or groups of the tenant
-- (docs/prd/GOV-governed-data-assets.md R11): `glossary_terms.steward` holds
-- `user:<id>` or `group:<id>` from now on, like an asset's steward.
--
-- Free text that names exactly one person who has signed in (their e-mail or
-- their display name, any case) becomes that person's reference. Everything
-- else cannot name anyone, so it moves to the notes, and the field is emptied.
-- Groups live only in the identity server, so no text becomes a group here.

DO $$
BEGIN
  IF to_regclass('public.iam_principals') IS NOT NULL THEN
    UPDATE glossary_terms t
       SET steward = 'user:' || m.sub
      FROM (
        SELECT g.id, min(p.sub) AS sub
          FROM glossary_terms g
          JOIN public.iam_principals p
            ON lower(trim(g.steward)) IN (lower(p.email), lower(p.display_name))
         WHERE g.steward IS NOT NULL
           AND g.steward !~ '^(user|group):'
         GROUP BY g.id
        HAVING count(DISTINCT p.sub) = 1
      ) m
     WHERE t.id = m.id;
  END IF;
END $$;

UPDATE glossary_terms
   SET notes = CASE
         WHEN coalesce(trim(notes), '') = ''
           THEN 'Steward (before 2026-11): ' || trim(steward)
         ELSE notes || E'\n\n' || 'Steward (before 2026-11): ' || trim(steward)
       END,
       steward = NULL
 WHERE steward IS NOT NULL
   AND steward !~ '^(user|group):[A-Za-z0-9._:-]+$';
