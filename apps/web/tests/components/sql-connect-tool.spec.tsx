import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";
import {
  ConnectToolHarness,
  SqlConnectionsCardHarness,
} from "./fixtures/sql-connect-harness";

type CtPage = Parameters<Parameters<typeof test>[2]>[0]["page"];

type Endpoint = { enabled: boolean; configured: boolean; host: string | null };

const GUIDE = "/docs/sql-connections/#making-the-endpoint-reachable";

/** Answers the SQL endpoint (after `delayMs`) and the lists the dialog reads. */
async function mockSql(page: CtPage, endpoint: Endpoint, delayMs = 0) {
  await page.route("**/data-connections/endpoint", async (route) => {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...endpoint,
        port: 5433,
        database: "shop",
        sslMode: "verify-full",
        caCertificate: null,
      }),
    });
  });
  await page.route(/\/data-connections$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [],
        canCreate: true,
        canManage: false,
        canConnectAll: false,
      }),
    }),
  );
  await page.route("**/data-connections/reachable", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/data-connections/exposures", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
}

test("the button is not drawn while the endpoint loads, so it never flashes", async ({
  mount,
  page,
}) => {
  await mockSql(page, { enabled: false, configured: false, host: null }, 600);
  await mount(<ConnectToolHarness />);
  const button = page.getByTestId("connect-tool");
  // Sampled without retrying (`toHaveCount` retries until it is true, which a
  // button drawn first and taken back would also become): at no moment before
  // the answer is the button there. Drawn first, it flashed on and off.
  const seen: number[] = [];
  for (let i = 0; i < 5; i++) {
    seen.push(await button.count());
    await page.waitForTimeout(100);
  }
  expect(seen).toEqual([0, 0, 0, 0, 0]);
  // The answer is "off": still nothing.
  await page.waitForTimeout(900);
  expect(await button.count()).toBe(0);
});

test("gateway on with a public host: the button, no warning", async ({
  mount,
  page,
}) => {
  await mockSql(page, { enabled: true, configured: true, host: "sql.example.com" });
  await mount(<ConnectToolHarness />);
  await expect(page.getByTestId("connect-tool")).toBeVisible();
  await expect(page.getByTestId("connect-tool-unconfigured")).toHaveCount(0);
  await page.getByTestId("connect-tool").click();
  await expect(page.getByTestId("connect-tool-dialog")).toBeVisible();
  await expect(page.getByTestId("sql-endpoint-notice")).toHaveCount(0);
});

test("gateway on without a public host: the button stays and says what is missing", async ({
  mount,
  page,
}) => {
  await mockSql(page, { enabled: true, configured: false, host: null });
  await mount(<ConnectToolHarness />);
  await expect(page.getByTestId("connect-tool")).toBeVisible();
  await expect(page.getByTestId("connect-tool-unconfigured")).toBeVisible();
  await page.getByTestId("connect-tool").click();
  const notice = page.getByTestId("connect-tool-dialog").getByTestId("sql-endpoint-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute("data-state", "unconfigured");
  await expect(notice).toContainText("sqlGateway.publicHost");
  await expect(notice).toContainText("SQL_GATEWAY_PUBLIC_HOST");
  await expect(notice.getByTestId("sql-setup-guide")).toHaveAttribute("href", GUIDE);
});

test("Settings → SQL connections warns when unconfigured, and when switched off", async ({
  mount,
  page,
}) => {
  await mockSql(page, { enabled: true, configured: false, host: null });
  const component = await mount(<SqlConnectionsCardHarness />);
  const notice = page.getByTestId("sql-endpoint-notice");
  await expect(notice).toHaveAttribute("data-state", "unconfigured");
  await expect(notice.getByTestId("sql-setup-guide")).toHaveAttribute("href", GUIDE);
  await component.unmount();

  await page.unroute("**/data-connections/endpoint");
  await mockSql(page, { enabled: false, configured: false, host: null });
  await mount(<SqlConnectionsCardHarness />);
  await expect(page.getByTestId("sql-endpoint-notice")).toHaveAttribute("data-state", "off");
  await expect(page.getByTestId("sql-endpoint-notice")).toContainText("sqlGateway.enabled");
});

test("Settings → SQL connections has no warning once the gateway is configured", async ({
  mount,
  page,
}) => {
  await mockSql(page, { enabled: true, configured: true, host: "sql.example.com" });
  await mount(<SqlConnectionsCardHarness />);
  await expect(page.getByTestId("sql-connections-panel")).toBeVisible();
  await expect(page.getByTestId("sql-endpoint-notice")).toHaveCount(0);
});
