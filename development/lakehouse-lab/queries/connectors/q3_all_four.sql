-- Q3 all four: orders of films their buyer also rated.
SELECT c.country, m.genre, count(*) AS rated_orders, round(avg(r.stars), 3) AS avg_stars
FROM lab_s3_tables.tables_connectors.orders o
JOIN lab_shop.public.customers c ON c.id = o.customer_id
JOIN lab_meilisearch.indexes.movies m ON m.id = o.movie_id
JOIN lab_neo4j.relationships.rated r ON r.source_id = o.customer_id AND r.target_id = o.movie_id
WHERE m.genre IN ('Drama', 'Sci-Fi') AND c.country IN ('AT', 'DE')
GROUP BY c.country, m.genre ORDER BY c.country, m.genre
