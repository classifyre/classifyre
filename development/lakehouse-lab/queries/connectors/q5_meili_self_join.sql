-- Q5 one live table read twice: pairs of 2020 films of the same genre.
SELECT a.genre, count(*) AS pairs
FROM lab_meilisearch.indexes.movies a
JOIN lab_meilisearch.indexes.movies b ON a.genre = b.genre AND a.id < b.id
WHERE a.year = 2020 AND b.year = 2020
GROUP BY a.genre ORDER BY a.genre
