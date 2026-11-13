# SQL gateway smoke (dev stack)

Checks SQL connections (docs/prd/DQ-data-query.md §5.7) with real clients
against the skaffold dev stack, where the gateway is port-forwarded to
`localhost:25432` with a certificate for `localhost` (`helm/develop/values-dev.yaml`).

1. Sign in at http://localhost:3000 (`admin` / `admin`), Settings → SQL
   connections → New connection; copy the password and the user name.
2. Save the CA: `GET /api/<workspace>/data-connections/endpoint` →
   `caCertificate` (or *Download the certificate authority* in the dialog) as
   `ca.crt` here.
3. psql (libpq 17+ also tries `sslnegotiation=direct`):

   ```bash
   PGPASSWORD=… psql "host=localhost port=25432 dbname=lakehouse-lab user=<user> sslmode=verify-full sslrootcert=ca.crt"
   ```

4. pgJDBC (the driver DBeaver, Tableau and Metabase use):

   ```bash
   java -cp ~/Library/DBeaverData/drivers/maven/maven-central/org.postgresql/postgresql-42.7.11.jar JdbcSmoke.java \
     "jdbc:postgresql://localhost:25432/lakehouse-lab?ssl=true&sslmode=verify-full&sslrootcert=ca.crt" <user> <password> <schema> <table>
   ```

5. psqlODBC (Excel's driver), with Homebrew's `psqlodbc` and `unixodbc`:

   ```bash
   isql -v -k "Driver=/opt/homebrew/lib/psqlodbcw.so;Server=localhost;Port=25432;Database=lakehouse-lab;Uid=<user>;Pwd=<password>;SSLMode=verify-full;pqopt={sslrootcert=ca.crt}"
   ```

Not runnable here: Power BI, Excel itself and Tableau (Windows/desktop apps);
Npgsql (Power BI's driver) has no local runtime on this machine.

To see what a client sends, set `SQL_GATEWAY_TRACE=true` on the gateway
(`kubectl -n classifyre-dev set env deploy/classifyre-sql-gateway SQL_GATEWAY_TRACE=true`):
it logs message types, statement text and errors per session — never bound values.
