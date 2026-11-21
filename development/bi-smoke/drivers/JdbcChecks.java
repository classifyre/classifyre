import java.io.FileInputStream;
import java.sql.*;
import java.util.*;

/**
 * pgJDBC checks J1–J8 (docs/prd/BIC-bi-client-compatibility.md §5.3): what
 * DBeaver, Tableau and Metabase do through pgJDBC. Grows from
 * development/sql-gateway-smoke/JdbcSmoke.java. Run (run.sh does):
 *
 *   java -cp postgresql.jar JdbcChecks.java /tmp/spec.properties
 *
 * One line per check: __BI_SMOKE__ {"id":…,"ok":…,"ms":…,"detail":…,"columns":[…],"rows":[[…]]}
 */
public class JdbcChecks {
  static Properties spec = new Properties();

  interface Check { void run(Map<String, Object> out) throws Exception; }

  public static void main(String[] a) throws Exception {
    try (FileInputStream in = new FileInputStream(a[0])) { spec.load(in); }
    run("J1", JdbcChecks::j1);
    run("J2", JdbcChecks::j2);
    run("J3", JdbcChecks::j3);
    run("J4", JdbcChecks::j4);
    run("J5", JdbcChecks::j5);
    run("J6", JdbcChecks::j6);
    run("J7", JdbcChecks::j7);
    run("J8", JdbcChecks::j8);
  }

  static void run(String id, Check check) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("ok", true);
    out.put("detail", "");
    long t0 = System.currentTimeMillis();
    try {
      check.run(out);
    } catch (SQLException e) {
      out.put("ok", false);
      out.put("detail", "SQLException " + e.getSQLState() + ": " + firstLine(e.getMessage()));
    } catch (Exception e) {
      out.put("ok", false);
      out.put("detail", e.getClass().getSimpleName() + ": " + firstLine(String.valueOf(e.getMessage())));
    }
    out.put("ms", System.currentTimeMillis() - t0);
    StringBuilder line = new StringBuilder("{\"id\":").append(json(id));
    for (Map.Entry<String, Object> e : out.entrySet()) line.append(',').append(json(e.getKey())).append(':').append(json(e.getValue()));
    System.out.println("__BI_SMOKE__ " + line.append('}'));
    System.out.flush();
  }

  static String firstLine(String s) { return s == null ? "" : s.split("\n")[0]; }

  static Connection connect(String... extra) throws SQLException {
    String url = "jdbc:postgresql://" + spec.getProperty("host") + ":" + spec.getProperty("port") + "/" + spec.getProperty("database");
    Properties p = new Properties();
    p.setProperty("user", spec.getProperty("user"));
    p.setProperty("password", spec.getProperty("password"));
    p.setProperty("ssl", "true");
    p.setProperty("sslmode", "verify-full");
    p.setProperty("sslrootcert", spec.getProperty("ca"));
    p.setProperty("ApplicationName", "bi-smoke pgJDBC " + System.getenv().getOrDefault("PGJDBC_VERSION", ""));
    p.setProperty("connectTimeout", "20");
    for (int i = 0; i + 1 < extra.length; i += 2) p.setProperty(extra[i], extra[i + 1]);
    return DriverManager.getConnection(url, p);
  }

  static List<String[]> tables() {
    List<String[]> out = new ArrayList<>();
    for (String t : spec.getProperty("tables").split(";")) if (!t.isEmpty()) out.add(t.split("\\|", 2));
    return out;
  }

  static String sql(String id) { return spec.getProperty("q." + id + ".sql"); }

  static void bind(PreparedStatement ps, String id) throws SQLException {
    String params = spec.getProperty("q." + id + ".params", "");
    if (params.isEmpty()) return;
    String[] values = params.split(",", -1);
    for (int i = 0; i < values.length; i++) {
      String v = values[i];
      if (v.matches("-?\\d+")) ps.setLong(i + 1, Long.parseLong(v));
      else ps.setString(i + 1, v);
    }
  }

  static void read(ResultSet rs, Map<String, Object> out) throws SQLException {
    ResultSetMetaData m = rs.getMetaData();
    List<String> cols = new ArrayList<>();
    List<String> types = new ArrayList<>();
    for (int i = 1; i <= m.getColumnCount(); i++) { cols.add(m.getColumnLabel(i)); types.add(m.getColumnTypeName(i)); }
    List<List<Object>> rows = new ArrayList<>();
    while (rs.next() && rows.size() < 1000) {
      List<Object> row = new ArrayList<>();
      for (int i = 1; i <= m.getColumnCount(); i++) row.add(rs.getString(i));
      rows.add(row);
    }
    out.put("columns", cols);
    out.put("types", types);
    out.put("rows", rows);
  }

  // J1 DatabaseMetaData: schemas, tables, columns (remarks), primary keys (_pg_expandarray), imported keys, type info
  static void j1(Map<String, Object> out) throws Exception {
    List<String> notes = new ArrayList<>();
    List<String> missing = new ArrayList<>();
    try (Connection c = connect()) {
      DatabaseMetaData md = c.getMetaData();
      notes.add(md.getDatabaseProductName() + " " + md.getDatabaseProductVersion());
      Set<String> schemas = new TreeSet<>();
      try (ResultSet rs = md.getSchemas()) { while (rs.next()) schemas.add(rs.getString(1)); }
      Map<String, List<String>> columns = new LinkedHashMap<>();
      for (String[] t : tables()) {
        if (!schemas.contains(t[0])) missing.add("schema " + t[0]);
        boolean found = false;
        try (ResultSet rs = md.getTables(null, t[0], t[1], new String[] {"TABLE"})) { found = rs.next(); }
        if (!found) missing.add("table " + t[0] + "." + t[1]);
        List<String> cols = new ArrayList<>();
        try (ResultSet rs = md.getColumns(null, t[0], t[1], "%")) {
          while (rs.next()) cols.add(rs.getString("COLUMN_NAME") + ":" + rs.getString("TYPE_NAME") + (rs.getString("REMARKS") != null ? " (" + rs.getString("REMARKS") + ")" : ""));
        }
        if (cols.isEmpty()) missing.add("columns of " + t[0] + "." + t[1]);
        columns.put(t[0] + "." + t[1], cols);
        try (ResultSet rs = md.getPrimaryKeys(null, t[0], t[1])) { while (rs.next()) { } }
        try (ResultSet rs = md.getImportedKeys(null, t[0], t[1])) { while (rs.next()) { } }
      }
      int types = 0;
      try (ResultSet rs = md.getTypeInfo()) { while (rs.next()) types++; }
      notes.add(schemas.size() + " schemas, " + types + " types");
      out.put("columns", columns);
    }
    out.put("ok", missing.isEmpty());
    out.put("detail", String.join("; ", notes) + (missing.isEmpty() ? "" : "; missing " + missing));
  }

  // J2 server-prepared parameterised statement, binary transfer (prepareThreshold=-1 forces it)
  static void j2(Map<String, Object> out) throws Exception {
    try (Connection c = connect("prepareThreshold", "-1"); PreparedStatement ps = c.prepareStatement(sql("J2"))) {
      bind(ps, "J2");
      try (ResultSet rs = ps.executeQuery()) { read(rs, out); }
    }
  }

  // J3 fetch size 2 inside a transaction: Execute(maxRows) portals, suspended and resumed
  static void j3(Map<String, Object> out) throws Exception {
    try (Connection c = connect()) {
      c.setAutoCommit(false);
      try (Statement s = c.createStatement()) {
        s.setFetchSize(2);
        try (ResultSet rs = s.executeQuery(sql("J3"))) { read(rs, out); }
      }
      c.commit();
    }
    out.put("detail", ((List<?>) out.get("rows")).size() + " rows through a 2-row portal");
  }

  // J4 the simple query protocol (no Parse/Bind)
  static void j4(Map<String, Object> out) throws Exception {
    try (Connection c = connect("preferQueryMode", "simple"); Statement s = c.createStatement(); ResultSet rs = s.executeQuery(sql("J4"))) { read(rs, out); }
  }

  // J5 setReadOnly → BEGIN READ ONLY (POC F3); SET SESSION CHARACTERISTICS (POC F4, what Metabase sends)
  static void j5(Map<String, Object> out) throws Exception {
    try (Connection c = connect()) {
      try (Statement s = c.createStatement()) { s.execute("SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL READ UNCOMMITTED"); }
      c.setReadOnly(true);
      c.setAutoCommit(false);
      try (Statement s = c.createStatement(); ResultSet rs = s.executeQuery(sql("J5"))) { read(rs, out); }
      c.commit();
    }
    out.put("detail", "BEGIN READ ONLY + SET SESSION CHARACTERISTICS accepted");
  }

  // J6 errors carry SQLSTATEs, and the session survives them
  static void j6(Map<String, Object> out) throws Exception {
    List<String> states = new ArrayList<>();
    String first = tables().get(0)[0], table = tables().get(0)[1];
    String name = "\"" + first + "\".\"" + table + "\"";
    try (Connection c = connect()) {
      try (Statement s = c.createStatement()) { s.executeQuery("SELECT no_such_column FROM " + name); states.add("unknown column ACCEPTED"); }
      catch (SQLException e) { states.add("unknown column " + e.getSQLState()); }
      try (Statement s = c.createStatement()) { s.executeUpdate("DELETE FROM " + name); states.add("DELETE ACCEPTED"); }
      catch (SQLException e) { states.add("DELETE " + e.getSQLState()); }
      try (Statement s = c.createStatement(); ResultSet rs = s.executeQuery(sql("J6"))) { rs.next(); states.add("then a query works"); }
    }
    String joined = String.join(", ", states);
    out.put("ok", joined.contains("unknown column 42703") && joined.contains("DELETE 42501") && joined.contains("then a query works"));
    out.put("detail", joined);
  }

  // J7 timestamptz under a non-UTC session time zone (POC O4)
  static void j7(Map<String, Object> out) throws Exception {
    try (Connection c = connect("options", "-c TimeZone=Europe/Vienna"); Statement s = c.createStatement(); ResultSet rs = s.executeQuery(sql("J7"))) { read(rs, out); }
    try (Connection c = connect("options", "-c TimeZone=Europe/Vienna"); Statement s = c.createStatement(); ResultSet rs = s.executeQuery("SHOW TimeZone")) {
      rs.next();
      out.put("detail", "session TimeZone " + rs.getString(1));
    }
  }

  // J8 setQueryTimeout(2) on a slow query: 57014 soon after, the session usable after
  static void j8(Map<String, Object> out) throws Exception {
    long t0 = System.currentTimeMillis();
    String state = "no error";
    try (Connection c = connect()) {
      try (Statement s = c.createStatement()) {
        s.setQueryTimeout(2);
        try (ResultSet rs = s.executeQuery(sql("J8"))) { while (rs.next()) { } }
      } catch (SQLException e) { state = e.getSQLState() + " " + firstLine(e.getMessage()); }
      long took = System.currentTimeMillis() - t0;
      boolean usable;
      try (Statement s = c.createStatement(); ResultSet rs = s.executeQuery(sql("J6"))) { usable = rs.next(); }
      out.put("ok", state.startsWith("57014") && took < 6000 && usable);
      out.put("detail", state + " after " + took + " ms; session usable after: " + usable);
    }
  }

  static String json(Object v) {
    if (v == null) return "null";
    if (v instanceof Boolean || v instanceof Number) return v.toString();
    if (v instanceof Map<?, ?> m) {
      StringBuilder b = new StringBuilder("{");
      for (Map.Entry<?, ?> e : m.entrySet()) { if (b.length() > 1) b.append(','); b.append(json(String.valueOf(e.getKey()))).append(':').append(json(e.getValue())); }
      return b.append('}').toString();
    }
    if (v instanceof Collection<?> c) {
      StringBuilder b = new StringBuilder("[");
      for (Object o : c) { if (b.length() > 1) b.append(','); b.append(json(o)); }
      return b.append(']').toString();
    }
    String s = v.toString();
    StringBuilder b = new StringBuilder("\"");
    for (char ch : s.toCharArray()) {
      switch (ch) {
        case '"' -> b.append("\\\"");
        case '\\' -> b.append("\\\\");
        case '\n' -> b.append("\\n");
        case '\r' -> b.append("\\r");
        case '\t' -> b.append("\\t");
        default -> { if (ch < 0x20) b.append(String.format("\\u%04x", (int) ch)); else b.append(ch); }
      }
    }
    return b.append('"').toString();
  }
}
