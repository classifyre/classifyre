import { checkDeploymentReadiness } from "./readiness";

const env = {
  IAM_ISSUER_URL: "http://localhost:3000/iam/realms/classifyre",
  IAM_INTERNAL_URL: "http://127.0.0.1:8180/iam",
  IAM_REALM: "classifyre",
  CLASSIFYRE_ALLINONE: "1",
  CLASSIFYRE_READY_FILE: "/run/classifyre/bootstrap.ready",
};

describe("deployment readiness", () => {
  it("reports ready only when API, IAM, tenant bootstrap, and all-in-one bootstrap are all ready", async () => {
    const fetchMock = jest.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("http://127.0.0.1:8000")) {
        return new Response(
          JSON.stringify({ status: "ok", tenantReady: true }),
          { status: 200 },
        );
      }
      if (url.includes("/.well-known/openid-configuration")) {
        return new Response(JSON.stringify({ issuer: env.IAM_ISSUER_URL }), {
          status: 200,
        });
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    const status = await checkDeploymentReadiness({
      env,
      apiUrls: ["http://127.0.0.1:8000"],
      fetchImpl: fetchMock,
      existsImpl: () => true,
    });

    expect(status).toEqual({
      ready: true,
      checks: { api: true, iam: true, tenant: true, bootstrap: true },
    });
  });

  it("stays not ready while IAM realm is not up or API tenant bootstrap has not finished", async () => {
    const fetchMock = jest.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("http://127.0.0.1:8000")) {
        return new Response(
          JSON.stringify({ status: "ok", tenantReady: false }),
          { status: 200 },
        );
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    const status = await checkDeploymentReadiness({
      env,
      apiUrls: ["http://127.0.0.1:8000"],
      fetchImpl: fetchMock,
      existsImpl: () => false,
    });

    expect(status).toEqual({
      ready: false,
      checks: { api: true, iam: false, tenant: false, bootstrap: false },
    });
  });

  it("skips the bootstrap marker check outside the all-in-one Docker image", async () => {
    const fetchMock = jest.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("http://127.0.0.1:8000")) {
        return new Response(
          JSON.stringify({ status: "ok", tenantReady: true }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const status = await checkDeploymentReadiness({
      env: { ...env, CLASSIFYRE_ALLINONE: undefined },
      apiUrls: ["http://127.0.0.1:8000"],
      fetchImpl: fetchMock,
      existsImpl: () => false,
    });

    expect(status.ready).toBe(true);
    expect(status.checks.bootstrap).toBe(true);
  });

  it("is stateless and notices an outage immediately after previously being ready", async () => {
    let healthy = true;
    const fetchMock = jest.fn(async () =>
      healthy
        ? new Response(JSON.stringify({ status: "ok", tenantReady: true }), {
            status: 200,
          })
        : new Response("", { status: 503 }),
    ) as unknown as typeof fetch;

    const first = await checkDeploymentReadiness({
      env: { ...env, CLASSIFYRE_ALLINONE: undefined },
      apiUrls: ["http://127.0.0.1:8000"],
      fetchImpl: fetchMock,
      existsImpl: () => true,
    });
    expect(first.ready).toBe(true);

    healthy = false;
    const second = await checkDeploymentReadiness({
      env: { ...env, CLASSIFYRE_ALLINONE: undefined },
      apiUrls: ["http://127.0.0.1:8000"],
      fetchImpl: fetchMock,
      existsImpl: () => true,
    });
    expect(second.ready).toBe(false);
  });
});
