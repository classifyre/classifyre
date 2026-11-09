"""SQL over the tables a source holds: one validated SELECT per process.

The API decides who may query what. It hands this package a request that
names the tables the person may read (``tables``), the recipes of the sources
behind them (``sources``) and the SQL they typed. Everything here exists to
keep that request honest:

* :mod:`.gate` parses the SQL with SQLGlot and refuses anything that is not a
  single read-only SELECT over those tables, using functions from an allowlist.
  It is the authority: a table that is not in the request does not exist.
* :mod:`.bindings` attaches each source to DuckDB under a hidden name
  (``__src_<n>``) with the source's own connection code.
* :mod:`.session` exposes only the allowed tables, as views named
  ``<source>.<schema>.<table>``, runs the query under a deadline and a row cap,
  and returns Arrow.
* :mod:`.runner` reads the request, posts the result back to the API and
  prints one status line.

See docs/prd/DQ-data-query.md.
"""
