import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";

/**
 * The smoke test, one spec for every way Classifyre ships: the Helm release
 * (.github/workflows/develop.yml, or the k3d dev stack locally) and the
 * all-in-one Docker image (docker/scripts/smoke.sh). Sign-in is always on. The
 * seed (scripts/smoke/seed.sh) made two people in the identity server and put
 * a folder with one file holding a fake secret where scans can read it.
 *
 * Run twice around a restart: first everything, keeping the workspace
 * (SMOKE_KEEP_WORKSPACE=1, SMOKE_RUN fixed), then `--grep @after-restart` with
 * SMOKE_AFTER_RESTART=1, which checks it survived and removes it.
 *
 * Selectors are data-testid or the identity server's own form ids, never
 * visible text, so a translation change cannot break it.
 */

const env = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`${name} is not set; run scripts/smoke/seed.sh first`);
  return value;
};

const BASE_URL = env("BASE_URL", "http://localhost:3000").replace(/\/$/, "");
const ADMIN = { user: env("SMOKE_ADMIN_USER"), password: env("SMOKE_ADMIN_PASSWORD") };
const VIEWER = { user: env("SMOKE_VIEWER_USER"), password: env("SMOKE_VIEWER_PASSWORD") };
const VIEWERS_GROUP = env("SMOKE_VIEWERS_GROUP", "/smoke-viewers");
const FOLDER = env("SMOKE_FOLDER", "/mnt/corpora/smoke");

const RUN = process.env.SMOKE_RUN || Date.now().toString(36);
const AFTER_RESTART = process.env.SMOKE_AFTER_RESTART === "1";
const WORKSPACE_NAME = `Smoke ${RUN}`;
const SLUG = `smoke-${RUN}`;
const SOURCE_NAME = `Smoke folder ${RUN}`;

/** Calls the API through the web app, signed in by the page's cookies. */
class Api {
  constructor(private readonly request: APIRequestContext) {}

  async call<T = unknown>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: T }> {
    const response = await this.request.fetch(`${BASE_URL}/api${path}`, {
      method,
      // Signed-in writes must come from the app's own origin.
      headers: { Origin: BASE_URL, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      data: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON: keep the text for the failure message.
    }
    return { status: response.status(), body: parsed as T };
  }

  async ok<T = unknown>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
    const result = await this.call<T>(method, path, body);
    expect(result.status, `${method} ${path}: ${JSON.stringify(result.body)}`).toBeLessThan(300);
    return result.body;
  }
}

async function signIn(page: Page, who: { user: string; password: string }): Promise<void> {
  // Straight to sign-in: with a public tenant "/" opens for visitors instead.
  await page.goto("/auth/login/?returnTo=%2F");
  // The identity server asks for the username first (organizations), then the password.
  await page.locator("#username").fill(who.user);
  const password = page.locator("#password");
  if (!(await password.isVisible())) await page.locator("#kc-login").click();
  await password.fill(who.password);
  await page.locator("#kc-login").click();
  await expect(
    page.locator('[data-testid="workspace-directory"], [data-testid="workspace-empty-state"]').first(),
  ).toBeVisible({ timeout: 60_000 });
}

async function signedIn(browser: Browser, who: { user: string; password: string }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, who);
  return { context, page, api: new Api(context.request) };
}

/** Creates a workspace in the UI and returns its id. */
async function createWorkspace(
  { page, api }: { page: Page; api: Api },
  name: string,
  slug: string,
): Promise<string> {
  await page.goto("/");
  // The header button, or the empty state's on an install with no workspaces.
  await page
    .locator('[data-testid="workspace-create"], [data-testid="workspace-create-first"]')
    .first()
    .click();
  const dialog = page.getByTestId("workspace-create-dialog");
  await dialog.getByTestId("workspace-create-name").fill(name);
  // Every workspace is owned by a group; the admin's is /admins.
  await dialog.getByTestId("workspace-create-owner").click();
  await page.getByTestId("workspace-create-owner-/admins").click();
  await dialog.getByTestId("workspace-create-submit").click();
  await expect(dialog).toBeHidden({ timeout: 120_000 });

  const workspaces = await api.ok<Array<{ id: string; slug: string }>>("GET", "/namespaces");
  const created = workspaces.find((ws) => ws.slug === slug);
  expect(created, `workspace ${slug} in ${JSON.stringify(workspaces.map((w) => w.slug))}`).toBeTruthy();
  return created!.id;
}

test.describe.serial("smoke with sign-in", () => {
  let admin: Awaited<ReturnType<typeof signedIn>>;
  let viewer: Awaited<ReturnType<typeof signedIn>>;
  let workspaceId = "";
  let sourceId = "";

  test.beforeAll(async ({ browser }) => {
    admin = await signedIn(browser, ADMIN);
  });

  test.afterAll(async () => {
    if (workspaceId && process.env.SMOKE_KEEP_WORKSPACE !== "1") {
      await admin.api.call("DELETE", `/namespaces/${workspaceId}`);
    }
    await viewer?.context.close();
    await admin?.context.close();
  });

  test("after a restart the workspace and its findings are still there @after-restart", async () => {
    test.skip(!AFTER_RESTART, "runs once the deployment restarted (SMOKE_AFTER_RESTART=1)");
    const workspaces = await admin.api.ok<Array<{ id: string; slug: string }>>("GET", "/namespaces");
    const kept = workspaces.find((ws) => ws.slug === SLUG);
    expect(kept, `workspace ${SLUG} after the restart`).toBeTruthy();
    workspaceId = kept!.id;
    await expect
      .poll(
        async () => (await admin.api.ok<{ total: number }>("GET", `/${SLUG}/findings/stats`)).total,
        { timeout: 2 * 60_000, intervals: [5_000] },
      )
      .toBeGreaterThanOrEqual(1);
    await admin.page.goto(`/${SLUG}/sources`);
    await expect(admin.page.getByText(SOURCE_NAME, { exact: true }).first()).toBeVisible();
  });

  test("without signing in: only public workspaces, nothing to change", async () => {
    const anonymous = await playwrightRequest.newContext();
    const listed = await anonymous.get(`${BASE_URL}/api/namespaces`);
    expect(listed.status()).toBe(200);
    expect(Array.isArray(await listed.json())).toBe(true);
    const tenant = await anonymous.get(`${BASE_URL}/api/tenant/grants`);
    expect(tenant.status()).toBe(401);
    await anonymous.dispose();
  });

  test("the admin creates a workspace", async () => {
    workspaceId = await createWorkspace(admin, WORKSPACE_NAME, SLUG);
  });

  test("a local folder scan finds the file and its secret", async () => {
    const { page, api } = admin;
    const source = await api.ok<{ id: string }>("POST", `/${SLUG}/sources`, {
      type: "LOCAL_FOLDER",
      name: SOURCE_NAME,
      config: {
        type: "LOCAL_FOLDER",
        required: { path: FOLDER },
        // A ConfigMap mount is symlinks into its `..data` folder.
        optional: { traversal: { follow_symlinks: true } },
        sampling: { strategy: "ALL" },
        detectors: [{ type: "SECRETS", enabled: true }],
      },
    });
    sourceId = source.id;
    await api.ok("POST", `/${SLUG}/sources/${sourceId}/runs`);

    await expect
      .poll(
        async () => (await api.ok<{ runnerStatus?: string }>("GET", `/${SLUG}/sources/${sourceId}`)).runnerStatus,
        { timeout: 12 * 60_000, intervals: [5_000] },
      )
      .toMatch(/^(COMPLETED|FAILED|ERROR|CANCELLED)$/);
    const finished = await api.ok<{ runnerStatus?: string }>("GET", `/${SLUG}/sources/${sourceId}`);
    expect(finished.runnerStatus).toBe("COMPLETED");

    const assets = await api.ok<{ total: number }>("GET", `/${SLUG}/sources/${sourceId}/assets`);
    expect(assets.total).toBeGreaterThanOrEqual(1);
    await expect
      .poll(
        async () =>
          (await api.ok<{ total: number }>("GET", `/${SLUG}/findings/stats?sourceId=${sourceId}`)).total,
        { timeout: 2 * 60_000, intervals: [5_000] },
      )
      .toBeGreaterThanOrEqual(1);

    await page.goto(`/${SLUG}/sources`);
    await expect(page.getByText(SOURCE_NAME, { exact: true }).first()).toBeVisible();

    // "First scan complete" went to the workspace's owning group, which the
    // admin is in (notifications go to groups).
    await expect
      .poll(
        async () =>
          (
            await api.ok<{ notifications: Array<{ type: string; sourceId?: string | null }> }>(
              "GET",
              `/${SLUG}/notifications`,
            )
          ).notifications.some((n) => n.type === "SOURCE" && n.sourceId === sourceId),
        { timeout: 60_000, intervals: [5_000] },
      )
      .toBe(true);
  });

  test("a viewer sees the workspace only once given access, and only reads", async ({ browser }) => {
    viewer = await signedIn(browser, VIEWER);
    const before = await viewer.api.ok<Array<{ slug: string }>>("GET", "/namespaces");
    expect(before.map((ws) => ws.slug)).not.toContain(SLUG);
    expect((await viewer.api.call("GET", `/${SLUG}/sources`)).status).toBe(404);

    const groups = await admin.api.ok<Array<{ id: string; path: string }>>("GET", `/${SLUG}/access/groups`);
    const group = groups.find((g) => g.path === VIEWERS_GROUP);
    expect(group, `group ${VIEWERS_GROUP} in ${JSON.stringify(groups.map((g) => g.path))}`).toBeTruthy();
    await admin.api.ok("POST", `/${SLUG}/access/grants`, {
      subjectType: "group",
      subjectId: group!.id,
      roleKey: "viewer",
    });

    await expect
      .poll(async () => (await viewer.api.ok<Array<{ slug: string }>>("GET", "/namespaces")).map((ws) => ws.slug), {
        timeout: 90_000,
        intervals: [5_000],
      })
      .toContain(SLUG);
    await viewer.page.goto("/");
    await expect(viewer.page.getByTestId(`workspace-card-${SLUG}`)).toBeVisible();
    expect((await viewer.api.call("GET", `/${SLUG}/sources/${sourceId}`)).status).toBe(200);
    const write = await viewer.api.call("POST", `/${SLUG}/sources`, {
      type: "LOCAL_FOLDER",
      name: "Not allowed",
      config: { type: "LOCAL_FOLDER", required: { path: FOLDER } },
    });
    expect(write.status).toBe(403);
  });

  // ── SQL over tables (docs/prd/DQ-data-query.md) ─────────────────────────
  // The scan made the fixture's orders.csv a table asset.
  type CatalogTable = { assetId: string; name: string; sqlName: string; canQuery: boolean };
  type QueryRun = { id: string; status: string; rowCount: number | null; error: { code: string } | null };
  const ordersTable = async (api: Api) => {
    const catalog = await api.ok<{ sources: Array<{ tables: CatalogTable[] }> }>(
      "GET",
      `/${SLUG}/data-query/catalog`,
    );
    const table = catalog.sources.flatMap((s) => s.tables).find((t) => t.name === "orders.csv");
    expect(table, "orders.csv in the SQL catalog").toBeTruthy();
    return table!;
  };
  const finished = async (api: Api, id: string) => {
    await expect
      .poll(async () => (await api.ok<QueryRun>("GET", `/${SLUG}/query-runs/${id}`)).status, {
        timeout: 5 * 60_000,
        intervals: [2_000],
      })
      .toMatch(/^(SUCCESS|ERROR|TIMEOUT|CANCELLED)$/);
    return api.ok<QueryRun>("GET", `/${SLUG}/query-runs/${id}`);
  };

  test("the admin queries the table straight away and exports it", async () => {
    const { page, api } = admin;
    const table = await ordersTable(api);
    expect(table.canQuery).toBe(true);
    const sql = `SELECT region, sum(amount) AS total FROM ${table.sqlName} GROUP BY region ORDER BY region`;
    await page.goto(`/${SLUG}/query/?sql=${encodeURIComponent(sql)}`);
    await page.getByTestId("run-query").click();
    // north, south, west
    await expect(page.getByTestId("query-row-count")).toContainText("3", { timeout: 5 * 60_000 });
    await expect(page.getByTestId("query-results")).toContainText("north");

    // The same table as Excel, from the menu, downloaded by the browser.
    const download = page.waitForEvent("download", { timeout: 5 * 60_000 });
    await page.getByTestId("export-query").click();
    await page.getByTestId("export-xlsx").click();
    expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);

    // And as CSV through the API: the whole table, with its header.
    const run = await api.ok<QueryRun>("POST", `/${SLUG}/query-runs`, {
      sql: `SELECT * FROM ${table.sqlName} ORDER BY order_id`,
      format: "csv",
    });
    expect((await finished(api, run.id)).rowCount).toBe(6);
    const file = await page.request.fetch(`${BASE_URL}/api/${SLUG}/query-runs/${run.id}/result`);
    expect(file.headers()["content-type"]).toContain("text/csv");
    expect((await file.text()).split("\n")[0]).toBe("order_id,region,amount,placed_on");

    // Nothing but SELECT, and nothing but the tables in the catalog.
    const refused = await api.ok<QueryRun>("POST", `/${SLUG}/query-runs`, {
      sql: "SELECT * FROM read_csv('/etc/passwd')",
    });
    expect(refused.error?.code).toBe("function_not_allowed");
  });

  test("a viewer sees the table locked until their group is given data access to it", async () => {
    const before = await ordersTable(viewer.api);
    expect(before.canQuery).toBe(false);
    const refused = await viewer.api.call<{ code?: string }>("POST", `/${SLUG}/query-runs`, {
      sql: `SELECT * FROM ${before.sqlName}`,
    });
    expect(refused.status).toBe(403);

    const groups = await admin.api.ok<Array<{ id: string; path: string }>>("GET", `/${SLUG}/access/groups`);
    const group = groups.find((g) => g.path === VIEWERS_GROUP)!;
    await admin.api.ok("POST", `/${SLUG}/access/grants`, {
      subjectType: "group",
      subjectId: group.id,
      roleKey: "data-reader",
      scopeType: "asset",
      resourceId: before.assetId,
    });
    await expect
      .poll(async () => (await ordersTable(viewer.api)).canQuery, { timeout: 90_000, intervals: [5_000] })
      .toBe(true);

    // The source's Data tab: its tables beside the editor, and the access
    // just given on one of them in the source's Access and Activity.
    {
      const { page } = admin;
      await page.goto(`/${SLUG}/sources/${sourceId}/?tab=data`);
      const tab = page.getByTestId("source-data-tab");
      await expect(tab).toBeVisible({ timeout: 60_000 });
      await expect(tab.getByTestId(`catalog-table-${before.sqlName}`)).toBeVisible();
      await expect(tab.getByTestId("data-access-table")).toContainText(VIEWERS_GROUP);
      await tab.getByTestId("data-activity-tab").click();
      await expect(tab.getByTestId("data-access")).toContainText(VIEWERS_GROUP, { timeout: 30_000 });
    }

    const { page } = viewer;
    await page.goto(`/${SLUG}/assets/${before.assetId}/?tab=data`);
    await expect(page.getByTestId("asset-data-tab")).toBeVisible();
    await page.getByTestId("run-query").click();
    await expect(page.getByTestId("query-row-count")).toContainText("6", { timeout: 5 * 60_000 });
    // Reading is not taking out: no export without data.export.
    await expect(page.getByTestId("export-query")).toHaveCount(0);
    const exported = await viewer.api.call<{ code?: string }>("POST", `/${SLUG}/query-runs`, {
      sql: `SELECT * FROM ${before.sqlName}`,
      format: "xlsx",
    });
    expect(exported.status).toBe(403);
    expect(exported.body.code).toBe("EXPORT_NOT_ALLOWED");
  });

  test("a public workspace is read-only for visitors, and closes again when made private", async ({
    browser,
  }) => {
    const visitorContext = await browser.newContext();
    const visitor = new Api(visitorContext.request);
    try {
      expect((await visitor.call("GET", `/${SLUG}/sources`)).status, "private: sign in").toBe(401);

      // The admin makes it public from Settings → Access.
      const { page } = admin;
      await page.goto(`/${SLUG}/settings/?tab=access`);
      await page.getByTestId("public-workspace-switch").click();
      await page.getByTestId("public-workspace-confirm").click();
      await expect(page.getByTestId("public-workspace-switch")).toHaveAttribute("data-state", "checked");

      // No session: the directory lists it, with Sign in on top, and it reads.
      const visitorPage = await visitorContext.newPage();
      await visitorPage.goto("/");
      await expect(visitorPage.getByTestId("sign-in")).toBeVisible();
      await expect(visitorPage.getByTestId(`workspace-card-${SLUG}`)).toBeVisible();
      const listed = (await visitor.ok<Array<{ slug: string }>>("GET", "/namespaces")).map((ws) => ws.slug);
      expect(listed).toContain(SLUG);
      expect((await visitor.call("GET", `/${SLUG}/sources`)).status).toBe(200);
      expect((await visitor.call("GET", `/${SLUG}/findings/stats`)).status).toBe(200);
      // Read-only: changing anything, who has access and notifications ask
      // them to sign in.
      const write = await visitor.call("POST", `/${SLUG}/sources`, {
        type: "LOCAL_FOLDER",
        name: "Not allowed",
        config: { type: "LOCAL_FOLDER", required: { path: FOLDER } },
      });
      expect(write.status).toBe(401);
      expect((await visitor.call("GET", `/${SLUG}/access/grants`)).status).toBe(401);
      expect((await visitor.call("GET", `/${SLUG}/notifications`)).status).toBe(401);
      // Nor is saving SQL, which would pool every visitor's queries together.
      const saved = await visitor.call("POST", `/${SLUG}/saved-queries`, {
        name: "Shared pool",
        sql: "SELECT 1",
      });
      expect(saved.status).toBe(401);

      // Private again: closed to visitors at once.
      await admin.api.ok("PATCH", `/namespaces/${workspaceId}`, { public: false });
      expect((await visitor.call("GET", `/${SLUG}/sources`)).status).toBe(401);
      expect(
        (await visitor.ok<Array<{ slug: string }>>("GET", "/namespaces")).map((ws) => ws.slug),
      ).not.toContain(SLUG);
    } finally {
      await visitorContext.close();
    }
  });
});
