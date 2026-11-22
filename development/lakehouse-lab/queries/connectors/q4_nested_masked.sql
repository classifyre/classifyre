-- Q4 nested fields and a mask: studio (JSON), tags (a list), customers.email
-- (masked for a Data reader).
SELECT o.order_id, m.title, m.studio, m.tags, c.email
FROM lab_s3_tables.tables_connectors.orders o
JOIN lab_meilisearch.indexes.movies m ON m.id = o.movie_id
JOIN lab_shop.public.customers c ON c.id = o.customer_id
WHERE o.order_id = 1
