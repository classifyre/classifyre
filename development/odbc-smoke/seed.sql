-- An invented sales database for the ODBC smoke test: a keyed parent, a child
-- with a foreign key, a view, and a table with no key at all (the three shapes
-- the source pages differently). Names and numbers are made up.
CREATE SCHEMA sales;

CREATE TABLE sales.customers (
  id    serial PRIMARY KEY,
  name  text NOT NULL,
  email text NOT NULL,
  iban  text
);
INSERT INTO sales.customers (name, email, iban)
SELECT 'Customer ' || g,
       'customer' || g || '@example.test',
       'DE89370400440532013' || lpad(g::text, 3, '0')
FROM generate_series(1, 40) g;

CREATE TABLE sales.orders (
  id          serial PRIMARY KEY,
  customer_id int NOT NULL REFERENCES sales.customers (id),
  total       numeric(10, 2) NOT NULL,
  placed_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO sales.orders (customer_id, total)
SELECT (g % 40) + 1, g * 12.5 FROM generate_series(1, 120) g;

CREATE VIEW sales.large_orders AS
  SELECT o.id, c.name, o.total FROM sales.orders o JOIN sales.customers c ON c.id = o.customer_id
  WHERE o.total > 500;

-- No primary key: read in order of arrival.
CREATE TABLE sales.support_notes (note text NOT NULL);
INSERT INTO sales.support_notes
SELECT 'Ticket ' || g || ': the customer wrote from customer' || g || '@example.test about an invoice'
FROM generate_series(1, 30) g;
