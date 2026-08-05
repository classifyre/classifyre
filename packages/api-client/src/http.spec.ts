import { resilientFetch } from "./http";

type FetchMock = jest.Mock<
  Promise<Response>,
  [RequestInfo | URL, RequestInit?]
>;

const jsonResponse = (status: number, body: unknown, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers });

function mockFetch(...responses: (Response | Error)[]): FetchMock {
  const fetchMock = jest.fn(() => {
    const next = responses.shift();
    if (!next) throw new Error("fetch called more times than expected");
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }) as unknown as FetchMock;
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const dbUnavailable = (code = "P2028") =>
  jsonResponse(
    503,
    { statusCode: 503, error: "Service Unavailable", code },
    { "Retry-After": "0" },
  );

describe("resilientFetch", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it("retries a GET that hits a transient database 503", async () => {
    const fetchMock = mockFetch(
      dbUnavailable(),
      jsonResponse(200, { items: [] }),
    );

    const response = await resilientFetch("https://api.test/runners");

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a POST to a search endpoint", async () => {
    const fetchMock = mockFetch(
      dbUnavailable(),
      jsonResponse(200, { total: 0 }),
    );

    const response = await resilientFetch(
      "https://api.test/acme/search/runners",
      {
        method: "POST",
        body: "{}",
      },
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a mutation when the 503 carries a transient database code", async () => {
    // P2028 guarantees the transaction rolled back, so replaying is safe even
    // for a write.
    const fetchMock = mockFetch(
      dbUnavailable(),
      jsonResponse(201, { id: "1" }),
    );

    const response = await resilientFetch("https://api.test/sources", {
      method: "POST",
      body: "{}",
    });

    expect(response.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a mutation on a bare gateway 503", async () => {
    const fetchMock = mockFetch(new Response("upstream down", { status: 503 }));

    const response = await resilientFetch("https://api.test/sources", {
      method: "POST",
      body: "{}",
    });

    expect(response.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a 4xx", async () => {
    const fetchMock = mockFetch(jsonResponse(404, { message: "not found" }));

    const response = await resilientFetch("https://api.test/runners/missing");

    expect(response.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a network failure on a read and returns the eventual response", async () => {
    const fetchMock = mockFetch(
      new TypeError("Failed to fetch"),
      jsonResponse(200, { ok: true }),
    );

    const response = await resilientFetch("https://api.test/runners");

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after the attempt budget and returns the last response", async () => {
    const fetchMock = mockFetch(
      dbUnavailable(),
      dbUnavailable(),
      dbUnavailable(),
    );

    const response = await resilientFetch("https://api.test/runners");

    expect(response.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("leaves the response body readable by the caller", async () => {
    mockFetch(dbUnavailable("P2028"), jsonResponse(200, { items: [1, 2] }));

    const response = await resilientFetch("https://api.test/runners");

    await expect(response.json()).resolves.toEqual({ items: [1, 2] });
  });

  it("never retries an aborted request", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const fetchMock = mockFetch(abort);

    await expect(resilientFetch("https://api.test/runners")).rejects.toThrow(
      "aborted",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
