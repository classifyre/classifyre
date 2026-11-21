-- Q2 Neo4j × Meilisearch × PostgreSQL: the films German customers rate highest.
SELECT m.title, count(*) AS fans
FROM lab_neo4j.relationships.rated r
JOIN lab_meilisearch.indexes.movies m ON m.id = r.target_id
JOIN lab_shop.public.customers c ON c.id = r.source_id
WHERE c.country = 'DE' AND r.stars >= 4 AND m.genre IN ('Sci-Fi', 'Horror')
GROUP BY m.title ORDER BY fans DESC, m.title LIMIT 5
