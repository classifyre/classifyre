import {
  checkDeploymentReadiness,
  isDeploymentKnownReady,
  markDeploymentNotReady,
  resetReadinessForTests,
} from "./readiness";

const env = {
  IAM_ISSUER_URL: "http://localhost:3000/iam/realms/classifyre",
  IAM_INTERNAL_URL: "http://127.0.0.1:8180/iam",
  IAM_REALM: "classifyre",
  CLASSIFYRE_ALLINONE: "1",
  CLASSIFYRE_READY_FILE: "/run/classifyre/bootstrap.ready",
};

describe("deployment readiness", () => {
  beforeEach(() => {
    resetReadinessForTests();
  });

  it("reports ready only when API, IAM, tenant bootstrap, and all-in-one bootstrap are all ready", async () => {
    const fetchMock = jest.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("http://127.0.0.1:8000")) {
        return new Response(JSON.stringify({ status: "ok", iamReady: true }), {
          status: 200,
        });
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
        return new Response(JSON.stringify({ status: "ok", iamReady: false }), {
          status: 200,
        });
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
        return new Response(JSON.stringify({ status: "ok", iamReady: true }), {
          status: 200,
        });
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

  it("caches readiness once ready and clears it when markDeploymentNotReady is called", async () => {
    const originalFetch = global.fetch;
    const originalEnv = { ...process.env };
    process.env.API_URL = "http://127.0.0.1:8000";
    process.env.IAM_INTERNAL_URL = "http://127.0.0.1:8180/iam";
    process.env.IAM_REALM = "classifyre";
    delete process.env.CLASSIFYRE_ALLINONE;

    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ status: "ok", iamReady: true }), {
        status: 200,
      }),
    ) as unknown as typeof fetch;

    try {
      expect(isDeploymentKnownReady()).toBe(false);
      const first = await checkDeploymentReadiness();
      expect(first.ready).toBe(true);
      expect(isDeploymentKnownReady()).toBe(true);

      markDeploymentNotReady();
      expect(isDeploymentKnownReady()).toBe(false);
    } finally {
      global.fetch = originalFetch;
      process.env = originalEnv;
    }
  });
});
