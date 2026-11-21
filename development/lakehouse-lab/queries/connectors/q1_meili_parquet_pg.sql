-- Q1 Meilisearch × Parquet in S3 × PostgreSQL: revenue by genre and country.
-- (A cast, not round(double, int): PostgreSQL has no such round.)
SELECT m.genre, c.country, count(*) AS orders, CAST(sum(o.amount) AS DECIMAL(18, 2)) AS revenue
FROM lab_s3_tables.tables_connectors.orders o
JOIN lab_meilisearch.indexes.movies m ON m.id = o.movie_id
JOIN lab_shop.public.customers c ON c.id = o.customer_id
WHERE m.genre = 'Drama' AND m.year >= 2015
GROUP BY m.genre, c.country ORDER BY revenue DESC, c.country LIMIT 5
