import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";

/**
 * The deploy smoke test, against a release with sign-in on
 * (.github/workflows/develop.yml, or the k3d dev stack locally). The seed
 * (scripts/smoke/seed.sh) made two people in the identity server and mounted
 * a folder with one file holding a fake secret into the scan jobs.
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

const RUN = Date.now().toString(36);
const WORKSPACE_NAME = `Smoke ${RUN}`;
const SLUG = `smoke-${RUN}`;
const SOURCE_NAME = `Smoke folder ${RUN}`;

/** Calls the API through the web app, signed in by the page's cookies. */
class Api {
  constructor(private readonly request: APIRequestContext) {}

  async call<T = unknown>(
    method: "GET" | "POST" | "DELETE",
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

  async ok<T = unknown>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
    const result = await this.call<T>(method, path, body);
    expect(result.status, `${method} ${path}: ${JSON.stringify(result.body)}`).toBeLessThan(300);
    return result.body;
  }
}

async function signIn(page: Page, who: { user: string; password: string }): Promise<void> {
  await page.goto("/");
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

test.describe.serial("smoke with sign-in", () => {
  let admin: Awaited<ReturnType<typeof signedIn>>;
  let viewer: Awaited<ReturnType<typeof signedIn>>;
  let workspaceId = "";
  let sourceId = "";

  test.beforeAll(async ({ browser }) => {
    admin = await signedIn(browser, ADMIN);
  });

  test.afterAll(async () => {
    if (workspaceId) await admin.api.call("DELETE", `/namespaces/${workspaceId}`);
    await viewer?.context.close();
    await admin?.context.close();
  });

  test("nothing answers without signing in", async () => {
    const anonymous = await playwrightRequest.newContext();
    const response = await anonymous.get(`${BASE_URL}/api/namespaces`);
    expect(response.status()).toBe(401);
    await anonymous.dispose();
  });

  test("the admin creates a workspace", async () => {
    const { page, api } = admin;
    await page.getByTestId("workspace-create").click();
    const dialog = page.getByTestId("workspace-create-dialog");
    await dialog.getByTestId("workspace-create-name").fill(WORKSPACE_NAME);
    const owner = dialog.getByTestId("workspace-create-owner");
    if (await owner.isVisible()) {
      await owner.click();
      await page.getByTestId("workspace-create-owner-/admins").click();
    }
    await dialog.getByTestId("workspace-create-submit").click();
    await expect(dialog).toBeHidden({ timeout: 120_000 });

    const workspaces = await api.ok<Array<{ id: string; slug: string }>>("GET", "/namespaces");
    const created = workspaces.find((ws) => ws.slug === SLUG);
    expect(created, `workspace ${SLUG} in ${JSON.stringify(workspaces.map((w) => w.slug))}`).toBeTruthy();
    workspaceId = created!.id;
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
});
