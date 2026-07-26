/**
 * The namespace every spec runs inside.
 *
 * Every API and web route is namespace-scoped (`host/<namespace>/<path>`), so a
 * test cannot talk to a bare `/sources` any more — it needs a namespace first.
 * One randomly-named namespace is provisioned per run in `global-setup.ts` and
 * shared by every spec, so the whole suite's data lands in one place.
 *
 * Usage inside a spec:
 *
 *   const ns = TestNamespace.shared();
 *   await request.get(ns.api("/sources"));   // API call
 *   await page.goto(ns.web("/sources"));     // web route
 *
 * Cleanup is controlled by `E2E_DELETE_NAMESPACE` in apps/e2e/.env:
 *   true  (default) — the namespace is deleted once the run finishes
 *   false           — it is kept and its slug printed, so you can open it in
 *                     the UI and inspect whatever the run produced
 */
import type { APIRequestContext } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { API_BASE } from "./helpers";

/**
 * Where global-setup hands the namespace to the worker processes. They are
 * separate processes, so `process.env` cannot carry it across.
 */
const STATE_FILE = path.resolve(__dirname, "..", ".e2e-namespace.json");

export interface NamespaceRecord {
  id: string;
  name: string;
  slug: string;
}

/** Whether the run should delete its namespace when it finishes. */
export function shouldDeleteNamespace(): boolean {
  const raw = (process.env.E2E_DELETE_NAMESPACE ?? "true").trim().toLowerCase();
  return !["false", "0", "no", "off"].includes(raw);
}

export class TestNamespace {
  private constructor(readonly record: NamespaceRecord) {}

  /**
   * Provision a namespace (creates its Postgres schema and runs migrations,
   * so this takes a few seconds) under a slug unique to this run.
   */
  static async create(
    request: APIRequestContext,
    prefix = "e2e",
  ): Promise<TestNamespace> {
    const slug = `${prefix}-${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 6)}`;

    const response = await request.post(`${API_BASE}/namespaces`, {
      data: {
        name: `E2E ${slug}`,
        slug,
        description: "Created by the Playwright suite; safe to delete.",
        type: "local",
      },
      timeout: 120_000,
    });

    if (!response.ok()) {
      throw new Error(
        `Failed to create namespace ${slug}: ${response.status()} ${await response.text()}`,
      );
    }

    return new TestNamespace((await response.json()) as NamespaceRecord);
  }

  /** Adopt an existing namespace by slug instead of creating one. */
  static async use(
    request: APIRequestContext,
    slug: string,
  ): Promise<TestNamespace> {
    const response = await request.get(`${API_BASE}/namespaces`);
    const all = (await response.json()) as NamespaceRecord[];
    const record = all.find((entry) => entry.slug === slug);
    if (!record) {
      throw new Error(`Namespace '${slug}' not found`);
    }
    return new TestNamespace(record);
  }

  /** The namespace this run is using. Call from inside a spec. */
  static shared(): TestNamespace {
    const restored = TestNamespace.restore();
    if (!restored) {
      throw new Error(
        "No namespace for this run — global-setup.ts did not complete. " +
          "Is the API reachable at API_BASE_URL?",
      );
    }
    return restored;
  }

  /** Hand this namespace to the worker processes. */
  persist(): void {
    fs.writeFileSync(STATE_FILE, JSON.stringify(this.record, null, 2));
  }

  /** Read back the run's namespace, or null when there is none. */
  static restore(): TestNamespace | null {
    if (!fs.existsSync(STATE_FILE)) {
      return null;
    }
    return new TestNamespace(
      JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as NamespaceRecord,
    );
  }

  static clearState(): void {
    fs.rmSync(STATE_FILE, { force: true });
  }

  get slug(): string {
    return this.record.slug;
  }

  get id(): string {
    return this.record.id;
  }

  /** Absolute API URL inside this namespace. */
  api(path: string): string {
    return `${API_BASE}/${this.slug}${path.startsWith("/") ? path : `/${path}`}`;
  }

  /** Web route inside this namespace (relative — Playwright applies baseURL). */
  web(path: string): string {
    return `/${this.slug}${path.startsWith("/") ? path : `/${path}`}`;
  }

  /**
   * Delete the namespace and everything the run created inside it. Never
   * throws — cleanup must not fail a run.
   *
   * This is the API's soft delete: the namespace stops being listed and
   * served and its workers are torn down, but its Postgres schema is retained.
   * That is the registry's documented contract, not something this helper can
   * change.
   */
  async dispose(request: APIRequestContext): Promise<void> {
    await request
      .delete(`${API_BASE}/namespaces/${this.record.id}`)
      .catch((error) =>
        console.warn(`Namespace cleanup failed for ${this.slug}:`, error),
      );
  }
}
