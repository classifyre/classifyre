/**
 * Kafka end-to-end: namespace → source → connection test → scan → findings.
 *
 * Runs against a real broker, over both transports the connector supports:
 * the native protocol (SASL_SSL) and the Kafka REST Proxy. The scan is driven
 * through the API rather than the UI so the assertions land on what the CLI
 * actually produced — topic assets and PII findings from sampled messages.
 *
 * Kafka topics can legitimately be empty, which would make "no findings" an
 * ambiguous result, so the spec seeds a handful of synthetic PII records into
 * the configured topic through the REST proxy before scanning.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import { requireEnv } from "./helpers";
import { TestNamespace } from "./namespace";

// ── Environment ────────────────────────────────────────────────────────────────

const KAFKA_HOST = requireEnv("KAFKA_HOST");
const KAFKA_PORT = Number(requireEnv("KAFKA_PORT"));
const KAFKA_REST_PORT = Number(requireEnv("KAFKA_REST_PORT"));
const KAFKA_USERNAME = requireEnv("KAFKA_USERNAME");
const KAFKA_PASSWORD = requireEnv("KAFKA_PASSWORD");
const KAFKA_CA = requireEnv("KAFKA_CA").replace(/\\n/g, "\n");
const KAFKA_TOPIC = process.env.KAFKA_TOPIC || "some-data";

const REST_BASE = `https://${KAFKA_HOST}:${KAFKA_REST_PORT}`;

// ── Fixtures ───────────────────────────────────────────────────────────────────

/** Records carrying obvious PII, so the PII detector has something to find. */
const SEED_RECORDS = [
  {
    value: {
      customer: "Alice Johnson",
      email: "alice.johnson@example.com",
      phone: "+1 415 555 0142",
      note: "refund requested",
    },
  },
  {
    value: {
      customer: "Bob Smith",
      email: "bob.smith@example.com",
      phone: "+44 20 7946 0958",
      note: "address change",
    },
  },
  {
    value: {
      customer: "Carol White",
      email: "carol.white@example.com",
      phone: "+49 30 901820",
      note: "duplicate account",
    },
  },
];

async function seedTopic(request: APIRequestContext): Promise<void> {
  const response = await request.post(`${REST_BASE}/topics/${KAFKA_TOPIC}`, {
    headers: {
      "Content-Type": "application/vnd.kafka.json.v2+json",
      Accept: "application/vnd.kafka.v2+json",
      Authorization: `Basic ${Buffer.from(`${KAFKA_USERNAME}:${KAFKA_PASSWORD}`).toString("base64")}`,
    },
    data: { records: SEED_RECORDS },
    timeout: 60_000,
  });
  expect(
    response.ok(),
    `Seeding ${KAFKA_TOPIC} failed: ${response.status()} ${await response.text()}`,
  ).toBeTruthy();
}

function brokerConfig() {
  return {
    type: "KAFKA",
    required: { auth_mode: "SASL", host: KAFKA_HOST, port: KAFKA_PORT },
    masked: {
      sasl_username: KAFKA_USERNAME,
      sasl_password: KAFKA_PASSWORD,
      ssl_ca: KAFKA_CA,
    },
    optional: {
      connection: { sasl_mechanism: "PLAIN" },
      scope: { include_topics: [KAFKA_TOPIC] },
    },
    sampling: { strategy: "ALL", rows_per_page: 50 },
    detectors: [{ type: "PII", enabled: true }],
  };
}

function restConfig() {
  return {
    type: "KAFKA",
    required: { auth_mode: "REST", host: KAFKA_HOST, port: KAFKA_REST_PORT },
    masked: { username: KAFKA_USERNAME, password: KAFKA_PASSWORD },
    optional: {
      connection: { rest_use_tls: true },
      scope: { include_topics: [KAFKA_TOPIC] },
    },
    sampling: { strategy: "ALL", rows_per_page: 50 },
    detectors: [{ type: "PII", enabled: true }],
  };
}

// ── API helpers ────────────────────────────────────────────────────────────────

async function createSource(
  request: APIRequestContext,
  ns: TestNamespace,
  name: string,
  config: Record<string, unknown>,
): Promise<string> {
  const response = await request.post(ns.api("/sources"), {
    data: { type: "KAFKA", name, description: name, config },
    timeout: 60_000,
  });
  expect(
    response.ok(),
    `Create source failed: ${response.status()} ${await response.text()}`,
  ).toBeTruthy();
  return ((await response.json()) as { id: string }).id;
}

async function testConnection(
  request: APIRequestContext,
  ns: TestNamespace,
  sourceId: string,
): Promise<void> {
  const response = await request.post(ns.api(`/sources/${sourceId}/test`), {
    data: {},
    timeout: 300_000,
  });
  const body = await response.text();
  expect(
    response.ok(),
    `Test connection HTTP ${response.status()}: ${body}`,
  ).toBeTruthy();
  expect(body, `Test connection did not succeed: ${body}`).toContain("SUCCESS");
}

async function runScan(
  request: APIRequestContext,
  ns: TestNamespace,
  sourceId: string,
): Promise<string> {
  const response = await request.post(ns.api(`/sources/${sourceId}/run`), {
    data: { triggerType: "MANUAL", triggeredBy: "e2e" },
    timeout: 60_000,
  });
  expect(
    response.ok(),
    `Start scan failed: ${response.status()} ${await response.text()}`,
  ).toBeTruthy();
  return ((await response.json()) as { id: string }).id;
}

interface RunnerSummary {
  status: string;
  assetsCreated?: number;
  assetsUpdated?: number;
  assetsUnchanged?: number;
  totalFindings?: number;
  errorMessage?: string | null;
}

async function waitForScan(
  request: APIRequestContext,
  ns: TestNamespace,
  runnerId: string,
  timeoutMs = 600_000,
): Promise<RunnerSummary> {
  const started = Date.now();
  let last: RunnerSummary = { status: "UNKNOWN" };

  while (Date.now() - started < timeoutMs) {
    const response = await request.get(ns.api(`/runners/${runnerId}`));
    if (response.ok()) {
      last = (await response.json()) as RunnerSummary;
      if (["COMPLETED", "WARNING", "ERROR", "STOPPED"].includes(last.status)) {
        return last;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }

  throw new Error(
    `Scan ${runnerId} did not finish within ${timeoutMs / 1000}s (last status ${last.status})`,
  );
}

async function getFindings(
  request: APIRequestContext,
  ns: TestNamespace,
  sourceId: string,
): Promise<{ detectorType?: string; matchedContent?: string }[]> {
  const response = await request.post(ns.api("/search/findings"), {
    data: { filters: { sourceId: [sourceId] }, page: { skip: 0, limit: 50 } },
    timeout: 60_000,
  });
  expect(
    response.ok(),
    `Findings search failed: ${response.status()} ${await response.text()}`,
  ).toBeTruthy();
  const body = (await response.json()) as {
    findings?: { detectorType?: string; matchedContent?: string }[];
  };
  return body.findings ?? [];
}

// ── Spec ───────────────────────────────────────────────────────────────────────

test.describe("Kafka source", () => {
  // Shared by the whole run and torn down (or kept) by global-teardown, so
  // nothing here deletes what it created — the sources, scans and findings
  // stay inspectable in the UI when E2E_DELETE_NAMESPACE=false.
  const ns = TestNamespace.shared();

  test.beforeAll(async ({ request }) => {
    await seedTopic(request);
  });

  /**
   * Both transports must behave identically: the same topic assets, the same
   * sampled messages, the same findings.
   */
  for (const transport of ["broker", "rest"] as const) {
    test(`scans topics and detects PII over the ${transport} transport`, async ({
      request,
    }) => {
      const config = transport === "broker" ? brokerConfig() : restConfig();
      const sourceId = await createSource(
        request,
        ns,
        `kafka-${transport}-e2e`,
        config,
      );

      await testConnection(request, ns, sourceId);

      const runnerId = await runScan(request, ns, sourceId);
      const runner = await waitForScan(request, ns, runnerId);
      expect(
        runner.status,
        `Scan finished as ${runner.status}: ${runner.errorMessage ?? ""}`,
      ).not.toBe("ERROR");

      // Assets: the topic was discovered.
      const assetsResponse = await request.get(
        ns.api(`/sources/${sourceId}/assets`),
      );
      expect(assetsResponse.ok()).toBeTruthy();
      const assetsBody = (await assetsResponse.json()) as {
        data?: { name: string; assetType: string }[];
        items?: { name: string; assetType: string }[];
      };
      const assets = assetsBody.data ?? assetsBody.items ?? [];
      expect(assets.map((asset) => asset.name)).toContain(KAFKA_TOPIC);

      // Findings: messages were sampled AND run through the PII detector.
      // A topic asset typed OTHER resolves to no text content type in the
      // detector pipeline, which silently yields zero findings — this is the
      // assertion that catches that regression.
      const findings = await getFindings(request, ns, sourceId);
      expect(
        findings.length,
        "No findings — messages were not sampled or detectors did not run",
      ).toBeGreaterThan(0);
      expect(
        findings.some((finding) => finding.detectorType === "PII"),
      ).toBeTruthy();
    });
  }
});
