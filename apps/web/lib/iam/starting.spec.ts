import { NextRequest } from "next/server";
import { GET } from "@/app/auth/starting/route";
import { escapeHtml, safeInlineJson } from "./html";
import { checkDeploymentReadiness } from "./readiness";
import { redirectToStarting, startingPageUrl } from "./starting";

jest.mock("./readiness", () => ({
  checkDeploymentReadiness: jest.fn(),
}));

const mockedReadiness = checkDeploymentReadiness as jest.MockedFunction<
  typeof checkDeploymentReadiness
>;

describe("HTML and inline JSON escaping", () => {
  it("escapes HTML entities", () => {
    expect(escapeHtml(`<a href="x">&</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;",
    );
  });

  it("neutralizes closing script tags and line separators in inline JSON", () => {
    const encoded = safeInlineJson("</script><img src=x>&\u2028\u2029");
    expect(encoded).not.toContain("</script>");
    expect(encoded).toContain("\\u003c/script\\u003e");
    expect(encoded).toContain("\\u0026");
    expect(encoded).toContain("\\u2028");
    expect(encoded).toContain("\\u2029");
  });
});

describe("startingPageUrl and redirectToStarting", () => {
  it("builds a 307 redirect against the public appUrl with sanitized returnTo", () => {
    expect(
      startingPageUrl("https://evil.example/steal", "https://classifyre.example").toString(),
    ).toBe("https://classifyre.example/auth/starting/?returnTo=%2F");

    const res = redirectToStarting("/default/sources", "https://classifyre.example");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://classifyre.example/auth/starting/?returnTo=%2Fdefault%2Fsources",
    );
    expect(res.headers.get("cache-control")).toBe("no-store");

    const unavailableRes = redirectToStarting(
      "/default/sources",
      "https://classifyre.example",
      { reason: "unavailable" },
    );
    expect(unavailableRes.headers.get("location")).toBe(
      "https://classifyre.example/auth/starting/?returnTo=%2Fdefault%2Fsources&reason=unavailable",
    );
  });
});

describe("GET /auth/starting/", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      IAM_ISSUER_URL: "https://classifyre.example/iam/realms/classifyre",
      IAM_INTERNAL_URL: "http://127.0.0.1:8180/iam",
      IAM_REALM: "classifyre",
      IAM_WEB_CLIENT_ID: "classifyre-web",
      IAM_WEB_CLIENT_SECRET: "secret",
      IAM_APP_URL: "https://classifyre.example",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.resetAllMocks();
  });

  it("redirects using IAM_APP_URL (never internal loopback request.url) once ready", async () => {
    mockedReadiness.mockResolvedValue({
      ready: true,
      checks: { api: true, iam: true, tenant: true, bootstrap: true },
    });

    const request = new NextRequest(
      "http://127.0.0.1:3100/auth/starting/?returnTo=%2Fdefault%2Fsources",
    );
    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://classifyre.example/default/sources",
    );
  });

  it("renders the 503 waiting page instead of 307 looping when reason=unavailable", async () => {
    mockedReadiness.mockResolvedValue({
      ready: true,
      checks: { api: true, iam: true, tenant: true, bootstrap: true },
    });

    const request = new NextRequest(
      "http://127.0.0.1:3100/auth/starting/?returnTo=%2Fdefault&reason=unavailable",
    );
    const response = await GET(request);
    const html = await response.text();

    expect(response.status).toBe(503);
    expect(html).toContain('id="step-iam" data-ready="false"');
    expect(html).toContain("window.setTimeout(poll, 4000)");
  });

  it("escapes </script> in returnTo so inline script injection is impossible", async () => {
    mockedReadiness.mockResolvedValue({
      ready: false,
      checks: { api: true, iam: false, tenant: false, bootstrap: false },
    });

    const payload = "/foo</script><img src=x onerror=alert(1)>";
    const request = new NextRequest(
      `http://127.0.0.1:3100/auth/starting/?returnTo=${encodeURIComponent(payload)}`,
    );
    const response = await GET(request);
    const html = await response.text();

    expect(response.status).toBe(503);
    expect(html).not.toContain("</script><img");
    expect(html).toContain("\\u003c/script\\u003e");
  });

  it("honors classifyre-language=GERMAN cookie via signInLocale", async () => {
    mockedReadiness.mockResolvedValue({
      ready: false,
      checks: { api: false, iam: false, tenant: false, bootstrap: false },
    });

    const request = new NextRequest("http://127.0.0.1:3100/auth/starting/", {
      headers: {
        cookie: "classifyre-language=GERMAN",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    const response = await GET(request);
    const html = await response.text();

    expect(html).toContain('<html lang="de">');
    expect(html).toContain("Classifyre wird vorbereitet");
  });
});
