-- Q6 a custom source (its notebook's scan()) × PostgreSQL: open tickets of the
-- first 1,000 customers by country and priority. status and the customer_id
-- range are sent to the notebook; the join key is not (no semi-join).
SELECT c.country, t.priority, count(*) AS tickets, min(t.opened) AS oldest
FROM lab_support.main.tickets t
JOIN lab_shop.public.customers c ON c.id = t.customer_id
WHERE t.status = 'open' AND t.customer_id <= 1000
GROUP BY c.country, t.priority ORDER BY c.country, t.priority
