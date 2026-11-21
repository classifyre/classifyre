# The client drivers BI tools load, in one throwaway image for the BI smoke
# (docs/prd/BIC-bi-client-compatibility.md §4). Built locally and imported
# into k3d by scripts/dev/bi-smoke.sh; never pushed.
#
#   psql 18 / libpq 18        postgres:18 (Debian trixie, PGDG repository)
#   psqlODBC 18.00.0006       odbc-postgresql from PGDG (Excel's and Power BI's ODBC driver)
#   unixODBC + pyodbc         to drive it the way an ODBC application does
#   pgJDBC 42.7.11            Maven Central (DBeaver's, Tableau's and Metabase's driver)
#   JDK 21                    runs JdbcChecks.java as a single-file program
FROM postgres:18

ARG PGJDBC_VERSION=42.7.11
ARG PSQLODBC_VERSION=1:18.00.0006-1.pgdg13+1

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      "odbc-postgresql=${PSQLODBC_VERSION}" unixodbc python3 python3-pyodbc \
      openjdk-21-jdk-headless ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /opt/bi-smoke \
 && curl -fsSL -o /opt/bi-smoke/postgresql.jar \
      "https://repo1.maven.org/maven2/org/postgresql/postgresql/${PGJDBC_VERSION}/postgresql-${PGJDBC_VERSION}.jar"

ENV PGJDBC_VERSION=${PGJDBC_VERSION}
COPY checks.py odbc_checks.py psql_checks.py JdbcChecks.java run.sh /opt/bi-smoke/
RUN chmod +x /opt/bi-smoke/run.sh

USER postgres
WORKDIR /tmp
ENTRYPOINT ["/opt/bi-smoke/run.sh"]
