-- ODBC: any database that has an ODBC driver, scanned through pyodbc and queried
-- through DuckDB's odbc_scanner.
ALTER TYPE "AssetType" ADD VALUE 'ODBC';
