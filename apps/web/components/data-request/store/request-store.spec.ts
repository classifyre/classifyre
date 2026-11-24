import type {
  DataRequestCheckResultDto,
  DataRequestDescribeResultDto,
  DataRequestDetailDto,
  QueryCatalogDto,
} from "@workspace/api-client";
import { createRequestStore, type RequestStoreDeps } from "./request-store";

const CATALOG: QueryCatalogDto = {
  limits: { maxRows: 1000, timeoutSeconds: 60, exportMaxRows: 10000 },
  sources: [
    {
      id: "src-1",
      name: "Shop",
      type: "POSTGRESQL",
      sqlName: "shop",
      tables: [
        {
          assetId: "a-orders",
          sourceId: "src-1",
          name: "orders",
          schema: "public",
          table: "orders",
          sqlName: "shop.public.orders",
          queryable: true,
          canQuery: true,
          columns: [
            { name: "id", type: "integer" },
            { name: "customer_id", type: "integer" },
            { name: "amount", type: "numeric" },
          ],
        },
        {
          assetId: "a-customers",
          sourceId: "src-1",
          name: "customers",
          schema: "public",
          table: "customers",
          sqlName: "shop.public.customers",
          queryable: true,
          canQuery: false,
          columns: [
            { name: "id", type: "integer" },
            { name: "region", type: "varchar" },
          ],
        },
      ],
    },
  ],
} as unknown as QueryCatalogDto;

function makeDetail(overrides: Partial<DataRequestDetailDto> = {}): DataRequestDetailDto {
  return {
    id: "case-1",
    kind: "DATA_REQUEST",
    title: "Q3 revenue",
    description: "Revenue by region",
    status: "OPEN",
    priority: "HIGH",
    state: "DRAFT",
    requester: { ref: "user:alice", name: "Alice" },
    routeGroup: { id: "g-fin", name: "Finance data" },
    audienceGroup: { id: "g-sales", name: "Sales" },
    assignee: null,
    datasetAssetId: null,
    datasetName: null,
    deliveredVersion: null,
    declineReason: null,
    submittedAt: null,
    deliveredAt: null,
    closedAt: null,
    createdAt: new Date("2026-11-24T10:00:00Z"),
    updatedAt: new Date("2026-11-24T10:00:00Z"),
    spec: { tables: [], joins: [], pins: [] },
    specVersion: 1,
    draftSql: "",
    sqlEdited: false,
    lastCheck: null,
    lastCheckSqlHash: null,
    dataset: null,
    deliveries: [],
    threads: [],
    permissions: {
      isRequester: true,
      isTeam: false,
      isManager: false,
      canEditSpec: true,
      canEditSql: false,
      canPreview: false,
      canSelfServe: false,
      allowedActions: ["submit", "withdraw"],
    },
    ...overrides,
  } as DataRequestDetailDto;
}

function makeDeps(overrides: Partial<RequestStoreDeps> = {}) {
  const saveSpec = jest.fn(async (_id, payload) =>
    makeDetail({
      spec: payload.spec as unknown as Record<string, unknown>,
      specVersion: payload.baseVersion + 1,
      draftSql: "SELECT o.id FROM shop.public.orders o",
    }),
  );
  const saveSql = jest.fn(async (_id, payload) =>
    makeDetail({
      specVersion: payload.baseVersion + 1,
      draftSql: payload.sql ?? "",
      sqlEdited: !payload.regenerate,
    }),
  );
  const check = jest.fn(
    async () =>
      ({
        ok: true,
        sql: "SELECT o.id FROM shop.public.orders o",
        routeGroup: { id: "g-fin", name: "Finance data" },
        precheckError: null,
        diagnostics: [],
        tables: [],
        problems: [],
      }) as unknown as DataRequestCheckResultDto,
  );
  const describe = jest.fn(
    async () =>
      ({
        cached: false,
        sqlHash: "abc",
        describe: null,
        error: null,
        check: {
          ok: true,
          sql: "",
          routeGroup: { id: "g-fin", name: "Finance data" },
          precheckError: null,
          diagnostics: [],
          tables: [],
          problems: [],
        },
      }) as unknown as DataRequestDescribeResultDto,
  );
  const reload = jest.fn(async () => makeDetail({ specVersion: 5 }));
  const onConflict = jest.fn();

  return {
    deps: {
      saveSpec,
      saveSql,
      check,
      describe,
      reload,
      onConflict,
      saveDebounceMs: 800,
      checkDebounceMs: 600,
      describeDebounceMs: 2000,
      ...overrides,
    } satisfies RequestStoreDeps,
    mocks: { saveSpec, saveSql, check, describe, reload, onConflict },
  };
}

describe("request-store", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("supports undo and redo while regenerating SQL live", () => {
    const { deps } = makeDeps();
    const store = createRequestStore("case-1", deps);
    store.getState().hydrate(makeDetail(), CATALOG);

    const orders = CATALOG.sources[0]!.tables[0]!;
    const customers = CATALOG.sources[0]!.tables[1]!;

    const t1 = store.getState().addTable(orders)!;
    expect(store.getState().spec.tables).toHaveLength(1);
    expect(store.getState().draftSql).toContain("FROM shop.public.orders");

    const t2 = store.getState().addTable(customers)!;
    // Unjoined second table reports disconnected_table diagnostic
    expect(
      store.getState().diagnostics.some((d) => d.code === "disconnected_table"),
    ).toBe(true);

    store
      .getState()
      .addJoin(
        { tableId: t1.id, column: "customer_id" },
        { tableId: t2.id, column: "id" },
      );
    expect(store.getState().diagnostics).toHaveLength(0);
    expect(store.getState().draftSql).toContain("INNER JOIN shop.public.customers");

    // Undo removes the join
    store.getState().undo();
    expect(store.getState().spec.joins).toHaveLength(0);
    expect(store.getState().redoStack).toHaveLength(1);

    // Redo restores the join
    store.getState().redo();
    expect(store.getState().spec.joins).toHaveLength(1);
    expect(store.getState().draftSql).toContain("INNER JOIN shop.public.customers");

    store.getState().dispose();
  });

  it("debounces saves at 800ms and checks at 600ms", async () => {
    const { deps, mocks } = makeDeps();
    const store = createRequestStore("case-1", deps);
    store.getState().hydrate(makeDetail(), CATALOG);

    const orders = CATALOG.sources[0]!.tables[0]!;
    const t1 = store.getState().addTable(orders)!;
    store.getState().toggleColumn(t1.id, "amount");
    store.getState().toggleColumn(t1.id, "amount");

    // Before 600ms: nothing sent yet
    jest.advanceTimersByTime(500);
    expect(mocks.saveSpec).not.toHaveBeenCalled();
    expect(mocks.check).not.toHaveBeenCalled();

    // At 600ms: check fires (flushing dirty save first)
    jest.advanceTimersByTime(150);
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.saveSpec).toHaveBeenCalledTimes(1);
    expect(mocks.check).toHaveBeenCalledTimes(1);
    expect(store.getState().specVersion).toBe(2);

    store.getState().dispose();
  });

  it("reloads and invokes onConflict on HTTP 409 version conflicts", async () => {
    const conflictErr = Object.assign(new Error("Conflict"), { status: 409 });
    const { deps, mocks } = makeDeps({
      saveSpec: jest.fn(async () => {
        throw conflictErr;
      }),
    });
    const store = createRequestStore("case-1", deps);
    store.getState().hydrate(makeDetail({ specVersion: 1 }), CATALOG);

    store.getState().addTable(CATALOG.sources[0]!.tables[0]!);
    await store.getState().flushSave();

    expect(mocks.onConflict).toHaveBeenCalledTimes(1);
    expect(mocks.reload).toHaveBeenCalledWith("case-1");
    expect(store.getState().conflictCount).toBe(1);
    expect(store.getState().specVersion).toBe(5);
    expect(store.getState().dirty).toBe(false);

    store.getState().dispose();
  });
});
