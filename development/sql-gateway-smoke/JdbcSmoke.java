import java.sql.*;
import java.util.*;

/**
 * What DBeaver, Tableau and Metabase do through pgJDBC, against the SQL
 * gateway (docs/prd/DQ-data-query.md §5.7). Run:
 *   java -cp postgresql-42.7.x.jar JdbcSmoke.java <url> <user> <password> <schema> <table>
 * The URL carries sslmode=verify-full&sslrootcert=<ca file>.
 */
public class JdbcSmoke {
  static void check(boolean ok, String what) {
    System.out.println((ok ? "ok   " : "FAIL ") + what);
    if (!ok) System.exit(1);
  }

  public static void main(String[] a) throws Exception {
    String url = a[0], user = a[1], password = a[2], schema = a[3], table = a[4];
    Properties p = new Properties();
    p.setProperty("user", user);
    p.setProperty("password", password);
    p.setProperty("prepareThreshold", "1"); // server-prepared at once: binary results
    try (Connection c = DriverManager.getConnection(url, p)) {
      DatabaseMetaData md = c.getMetaData();
      check(md.getDatabaseProductName().equals("PostgreSQL"), "product " + md.getDatabaseProductName() + " " + md.getDatabaseProductVersion());
      List<String> schemas = new ArrayList<>();
      try (ResultSet rs = md.getSchemas()) { while (rs.next()) schemas.add(rs.getString(1)); }
      check(schemas.contains(schema), "getSchemas lists " + schema + " " + schemas);
      List<String> tables = new ArrayList<>();
      try (ResultSet rs = md.getTables(null, schema, "%", new String[] {"TABLE"})) { while (rs.next()) tables.add(rs.getString("TABLE_NAME")); }
      check(tables.contains(table), "getTables " + tables);
      List<String> columns = new ArrayList<>();
      try (ResultSet rs = md.getColumns(null, schema, table, "%")) {
        while (rs.next()) columns.add(rs.getString("COLUMN_NAME") + ":" + rs.getString("TYPE_NAME") + (rs.getString("REMARKS") != null ? "(" + rs.getString("REMARKS") + ")" : ""));
      }
      check(!columns.isEmpty(), "getColumns " + columns);
      String name = "\"" + schema + "\".\"" + table + "\"";

      long t0 = System.currentTimeMillis();
      int rows = 0;
      try (Statement s = c.createStatement(); ResultSet rs = s.executeQuery("SELECT * FROM " + name + " LIMIT 5")) {
        ResultSetMetaData m = rs.getMetaData();
        while (rs.next()) {
          rows++;
          StringBuilder line = new StringBuilder();
          for (int i = 1; i <= m.getColumnCount(); i++) line.append(m.getColumnName(i)).append('=').append(rs.getObject(i)).append(' ');
          if (rows <= 2) System.out.println("     " + line);
        }
      }
      check(rows > 0, "SELECT * LIMIT 5 → " + rows + " rows in " + (System.currentTimeMillis() - t0) + " ms");

      t0 = System.currentTimeMillis();
      try (PreparedStatement ps = c.prepareStatement("SELECT count(*) AS n FROM " + name + " WHERE ? = ?")) {
        ps.setInt(1, 1);
        ps.setInt(2, 1);
        try (ResultSet rs = ps.executeQuery()) {
          rs.next();
          check(rs.getLong(1) > 0, "prepared count(*) with parameters = " + rs.getLong(1) + " in " + (System.currentTimeMillis() - t0) + " ms");
        }
      }

      c.setAutoCommit(false); // a fetch size is honoured inside a transaction: Execute(maxRows) portals
      t0 = System.currentTimeMillis();
      try (Statement s = c.createStatement()) {
        s.setFetchSize(2);
        int n = 0;
        try (ResultSet rs = s.executeQuery("SELECT * FROM " + name)) { while (rs.next()) n++; }
        check(n > 0, "fetch size 2 (portal suspended and resumed) → " + n + " rows in " + (System.currentTimeMillis() - t0) + " ms");
      }
      c.commit();
      c.setAutoCommit(true);

      try (Statement s = c.createStatement()) {
        s.executeQuery("SELECT * FROM " + name + " WHERE no_such_column = 1");
        check(false, "unknown column refused");
      } catch (SQLException e) {
        check(true, "unknown column refused: " + e.getSQLState() + " " + e.getMessage().split("\n")[0]);
      }
      try (Statement s = c.createStatement()) {
        s.executeUpdate("DELETE FROM " + name);
        check(false, "DELETE refused");
      } catch (SQLException e) {
        check(true, "DELETE refused: " + e.getSQLState() + " " + e.getMessage().split("\n")[0]);
      }

      try (Statement s = c.createStatement()) {
        Thread canceller = new Thread(() -> {
          try { Thread.sleep(1500); s.cancel(); } catch (Exception ignored) { }
        });
        canceller.start();
        t0 = System.currentTimeMillis();
        try {
          s.executeQuery("SELECT count(*) FROM " + name + " a, " + name + " b, " + name + " c");
          System.out.println("     (finished before the cancel)");
        } catch (SQLException e) {
          check("57014".equals(e.getSQLState()), "cancel → " + e.getSQLState() + " after " + (System.currentTimeMillis() - t0) + " ms");
        }
        canceller.join();
      }
      try (Statement s = c.createStatement(); ResultSet rs = s.executeQuery("SELECT 1")) {
        rs.next();
        check(rs.getInt(1) == 1, "session still usable after errors and cancel");
      }
    }
  }
}
