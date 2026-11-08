import * as fs from "fs";
import * as path from "path";
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

/**
 * The screenshots of the docs site's Access pages, taken from a dev stack with
 * sign-in (CLASSIFYRE_IAM=true ./scripts/dev/start.sh, then
 * `bun run web-iam:dev`). It plays the docs' example company, Brightwater
 * Logistics, through the real app and identity console:
 *
 *   rduarte     operator and tenant admin (group admins)
 *   mlindqvist  finance/workspace-managers: creates finance's workspaces
 *   tbrenner    finance/accounts-payable
 *   iokafor     legal
 *   kstrand     an account in no organization yet
 *
 * The people and groups are made in the identity server first, by
 * scripts/dev/iam-docs-seed.sh; everything in Classifyre is made here, and a
 * second run reuses what the first one made. Every name is invented.
 *
 *   DOCS_PASSWORD=... ./scripts/dev/iam-docs-seed.sh
 *   DOCS_PASSWORD=... npx playwright test -c playwright.docs.config.ts   (in apps/e2e)
 *   DOCS_SHOTS=sign-in,platform ...   re-takes only those images
 */

const PASSWORD = process.env.DOCS_PASSWORD ?? "";
const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
const OUT = path.resolve(__dirname, "../../docs/app/access/images");

const SIX_WEEKS = new Date(Date.now() + 42 * 24 * 3600 * 1000).toISOString();

type Group = { id: string; path: string };
type Grant = {
  id: string;
  subjectId: string;
  roleKey: string;
  scopeType: string;
  scopeId: string;
};
type Workspace = { id: string; slug: string; name: string };

class Api {
  constructor(private readonly request: APIRequestContext) {}

  async call<T>(
    method: "GET" | "POST" | "DELETE",
    url: string,
    body?: unknown,
  ): Promise<T> {
    const response = await this.request.fetch(`${BASE_URL}/api${url}`, {
      method,
      headers: {
        Origin: BASE_URL,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      data: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    expect(response.status(), `${method} ${url}: ${text}`).toBeLessThan(300);
    return (text ? JSON.parse(text) : null) as T;
  }
}

/** A context without the dev server's overlay badge, which is not part of the app. */
async function newContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal { display: none !important; }";
    document.addEventListener("DOMContentLoaded", () =>
      document.head.append(style),
    );
  });
  return context;
}

async function signIn(
  browser: Browser,
  user: string,
): Promise<{ context: BrowserContext; page: Page; api: Api }> {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.goto("/auth/login/?returnTo=%2F");
  await page.locator("#username").fill(user);
  const password = page.locator("#password");
  if (!(await password.isVisible())) await page.locator("#kc-login").click();
  await password.fill(PASSWORD);
  await page.locator("#kc-login").click();
  await page.waitForURL((url) => !url.pathname.startsWith("/iam/"), {
    timeout: 60_000,
  });
  return { context, page, api: new Api(context.request) };
}

/** `DOCS_SHOTS=a,b` re-takes only those; the rest of the run still sets things up. */
const ONLY = new Set((process.env.DOCS_SHOTS ?? "").split(",").filter(Boolean));

async function shot(page: Page, name: string, target?: Locator): Promise<void> {
  if (ONLY.size > 0 && !ONLY.has(name)) return;
  // Let fonts, transitions and the board's first frame settle.
  await page.waitForTimeout(700);
  const file = path.join(OUT, `${name}.png`);
  if (target) await target.screenshot({ path: file });
  else await page.screenshot({ path: file });
}

async function grant(
  api: Api,
  url: string,
  body: Omit<Grant, "id"> & { expiresAt?: string },
) {
  const existing = await api.call<Grant[]>("GET", url);
  const same = existing.find(
    (g) =>
      g.subjectId === body.subjectId &&
      g.roleKey === body.roleKey &&
      (url !== "/tenant/grants" || g.scopeId === body.scopeId),
  );
  if (!same) await api.call("POST", url, { subjectType: "group", ...body });
}

test("Access docs screenshots", async ({ browser }) => {
  expect(PASSWORD, "set DOCS_PASSWORD").not.toBe("");
  fs.mkdirSync(OUT, { recursive: true });

  await test.step("the sign-in page", async () => {
    const context = await newContext(browser);
    const page = await context.newPage();
    await page.goto("/auth/login/?returnTo=%2F");
    await expect(page.locator("#username")).toBeVisible();
    await page.waitForTimeout(4500); // a label or two on the board
    await shot(page, "sign-in");
    await context.close();
  });

  const operator = await signIn(browser, "rduarte");
  const tenant = await operator.api.call<{
    id: string;
    organizationId: string;
  }>("GET", "/tenant");
  const groups = await operator.api.call<Group[]>("GET", "/tenant/groups");
  const group = (p: string) => {
    const found = groups.find((g) => g.path === p);
    expect(
      found,
      `group ${p} in ${groups.map((g) => g.path).join(", ")}`,
    ).toBeTruthy();
    return found!;
  };

  await test.step("tenant grants: managers, finance readers, security auditors", async () => {
    await grant(operator.api, "/tenant/grants", {
      subjectId: group("/finance/workspace-managers").id,
      roleKey: "workspace-manager",
      scopeType: "group",
      scopeId: group("/finance").id,
    });
    await grant(operator.api, "/tenant/grants", {
      subjectId: group("/finance").id,
      roleKey: "viewer",
      scopeType: "group",
      scopeId: group("/finance").id,
    });
    await grant(operator.api, "/tenant/grants", {
      subjectId: group("/security").id,
      roleKey: "auditor",
      scopeType: "tenant",
      scopeId: tenant.id,
    });
  });

  const manager = await signIn(browser, "mlindqvist");
  const workspaces: Record<string, Workspace> = {};

  await test.step("a workspace manager creates finance's workspaces", async () => {
    const existing = await manager.api.call<Workspace[]>("GET", "/namespaces");
    for (const name of ["Finance ledger", "Vendor payments"]) {
      const slug = name.toLowerCase().replace(/\s+/g, "-");
      const found = existing.find((ws) => ws.slug === slug);
      if (found) {
        workspaces[slug] = found;
        continue;
      }
      const { page } = manager;
      await page.goto("/");
      await page
        .locator(
          '[data-testid="workspace-create"], [data-testid="workspace-create-first"]',
        )
        .first()
        .click();
      const dialog = page.getByTestId("workspace-create-dialog");
      await dialog.getByTestId("workspace-create-name").fill(name);
      await dialog.getByTestId("workspace-create-owner").click();
      if (slug === "finance-ledger") await shot(page, "create-workspace");
      await page.getByTestId("workspace-create-owner-/finance").click();
      await dialog.getByTestId("workspace-create-submit").click();
      await expect(dialog).toBeHidden({ timeout: 120_000 });
      const created = (
        await manager.api.call<Workspace[]>("GET", "/namespaces")
      ).find((ws) => ws.slug === slug);
      expect(created, slug).toBeTruthy();
      workspaces[slug] = created!;
    }
  });

  await test.step("workspace grants: payables investigate, legal and a contractor for six weeks", async () => {
    await grant(operator.api, "/vendor-payments/access/grants", {
      subjectId: group("/finance/accounts-payable").id,
      roleKey: "investigator",
      scopeType: "workspace",
      scopeId: workspaces["vendor-payments"]!.id,
    });
    await grant(operator.api, "/finance-ledger/access/grants", {
      subjectId: group("/legal").id,
      roleKey: "viewer",
      scopeType: "workspace",
      scopeId: workspaces["finance-ledger"]!.id,
      expiresAt: SIX_WEEKS,
    });
    const contractors = groups.find((g) => g.path === "/contractors");
    if (contractors) {
      await grant(operator.api, "/finance-ledger/access/grants", {
        subjectId: contractors.id,
        roleKey: "investigator",
        scopeType: "workspace",
        scopeId: workspaces["finance-ledger"]!.id,
        expiresAt: SIX_WEEKS,
      });
    }
  });

  await test.step("the operator's account menu, Tenant access and Platform", async () => {
    const { page } = operator;
    await page.goto("/");
    await expect(page.getByTestId("workspace-directory")).toBeVisible();
    await page.getByTestId("account-menu").click();
    await expect(page.getByTestId("identity-console")).toBeVisible();
    await shot(page, "account-menu");
    await page.keyboard.press("Escape");

    await page.goto("/tenant/");
    await expect(page.getByTestId("tenant-identity-console")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await shot(page, "tenant-access");

    await page.goto("/platform/");
    await expect(page.getByTestId("platform-identity-console")).toBeVisible();
    await page.waitForLoadState("networkidle");
    // Only the example's tenant and the public one: the dev stack has others.
    await page.evaluate(() => {
      for (const row of document.querySelectorAll("main li, ul > li")) {
        const text = row.textContent ?? "";
        if (/Workspaces: \d/.test(text) && !/Brightwater|Public/.test(text)) {
          (row as HTMLElement).style.display = "none";
        }
      }
    });
    await page.getByRole("button", { name: /Brightwater Logistics/ }).click();
    await shot(page, "platform");
    await page.keyboard.press("Escape");
  });

  await test.step("a workspace's access, seen by its manager", async () => {
    const { page } = manager;
    await page.goto("/finance-ledger/settings/?tab=access");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("/legal").first()).toBeVisible();
    await shot(page, "workspace-access", page.locator("main"));
  });

  await test.step("what each department sees", async () => {
    for (const [user, name] of [
      ["tbrenner", "home-accounts-payable"],
      ["iokafor", "home-legal"],
    ] as const) {
      const person = await signIn(browser, user);
      await expect(
        person.page.getByTestId("workspace-card-finance-ledger"),
      ).toBeVisible();
      await person.page.waitForLoadState("networkidle");
      await shot(person.page, name);
      await person.context.close();
    }
  });

  await test.step("everyone's own account page", async () => {
    const person = await signIn(browser, "tbrenner");
    await person.page.goto("/auth/account/");
    await expect(person.page.getByText("Personal info").first()).toBeVisible();
    await shot(person.page, "account-page");
    await person.context.close();
  });

  await test.step("someone in no organization yet", async () => {
    const newcomer = await signIn(browser, "kstrand");
    await newcomer.page.waitForURL(/\/auth\/no-tenant\//, { timeout: 60_000 });
    await shot(newcomer.page, "no-tenant");
    await newcomer.context.close();
  });

  await test.step("the identity console", async () => {
    const { page } = operator;
    const org = tenant.organizationId;
    await page.goto("/auth/console/");
    await expect(
      page.getByRole("link", { name: "Brightwater Logistics" }),
    ).toBeVisible();
    // The dev stack's own test organizations are not part of the example.
    await page.evaluate(() => {
      for (const row of document.querySelectorAll("tbody tr")) {
        if (/test_org/.test(row.textContent ?? ""))
          (row as HTMLElement).style.display = "none";
      }
    });
    await shot(page, "console-organizations");

    await page.goto(`/auth/console/?organization=${org}`);
    await page.getByRole("tab", { name: "Members" }).click();
    await expect(page.getByRole("link", { name: "mlindqvist" })).toBeVisible();
    await shot(page, "console-members");
    await page.getByRole("button", { name: "Add member" }).click();
    // Only the example's newcomer: the dev stack has other accounts.
    const search = page.getByRole("dialog").getByPlaceholder(/Search user/);
    await search.fill("kstrand");
    await search.press("Enter");
    await expect(
      page
        .getByRole("dialog")
        .getByRole("gridcell", { name: "kstrand", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("row", { name: /kstrand/ })
      .getByRole("checkbox")
      .check();
    await shot(page, "console-add-member");
    await page.keyboard.press("Escape");

    await page.getByRole("tab", { name: "Groups" }).click();
    await expect(
      page.getByRole("link", { name: "finance" }).first(),
    ).toBeVisible();
    await page.getByRole("link", { name: "finance" }).first().click();
    await expect(page.getByText("accounts-payable").first()).toBeVisible();
    await shot(page, "console-groups");

    await page.goto(
      `/iam/admin/classifyre/console/#/classifyre/users/add-user`,
    );
    await expect(page.getByLabel(/Username/).first()).toBeVisible();
    await shot(page, "console-create-user");
  });

  await test.step("a group deleted in the identity server shows as removed", async () => {
    if (!groups.some((g) => g.path === "/contractors")) return; // deleted by an earlier run
    const { page } = operator;
    await page.goto(`/auth/console/?organization=${tenant.organizationId}`);
    await page.getByRole("tab", { name: "Groups" }).click();
    const row = page.getByRole("row", { name: /contractors/ });
    await row.getByRole("button", { name: /kebab/i }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await shot(page, "console-delete-group");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete" })
      .click();

    const access = manager.page;
    await expect
      .poll(
        async () => {
          await access.goto("/finance-ledger/settings/?tab=access");
          await access.waitForLoadState("networkidle");
          return access.getByText("Removed group").count();
        },
        { timeout: 3 * 60_000, intervals: [15_000] },
      )
      .toBeGreaterThan(0);
    await shot(access, "removed-group", access.locator("main"));
  });

  await test.step("a visitor on the public tenant", async () => {
    const editor = await signIn(browser, "npark");
    const existing = await editor.api.call<Workspace[]>("GET", "/namespaces");
    if (!existing.some((ws) => ws.slug === "open-procurement")) {
      const owner = (
        await editor.api.call<Group[]>("GET", "/namespaces/owning-groups")
      )[0];
      expect(
        owner,
        "an owning group for the public tenant's editor",
      ).toBeTruthy();
      await editor.api.call("POST", "/namespaces", {
        name: "Open procurement",
        slug: "open-procurement",
        description: "Public tenders, published for anyone to read.",
        ownerGroupId: owner!.id,
      });
    }
    await editor.context.close();

    const visitor = await newContext(browser);
    const page = await visitor.newPage();
    await page.goto("/");
    await expect(page.getByTestId("sign-in")).toBeVisible();
    await expect(
      page.getByTestId("workspace-card-open-procurement"),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    await shot(page, "public-visitor");
    await visitor.close();
  });

  await test.step("someone without console rights is refused there", async () => {
    const { page } = manager;
    await page.goto("/auth/console/");
    await page.waitForTimeout(6000);
    await shot(page, "console-refused");
  });

  await manager.context.close();
  await operator.context.close();
});
