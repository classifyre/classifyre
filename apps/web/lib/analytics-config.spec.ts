import {
  ANALYTICS_CONFIG_GLOBAL,
  DEFAULT_COOKIE_POLICY_URL,
  readCookieConsentRuntimeConfig,
  readPostHogRuntimeConfig,
  type AnalyticsRuntimeConfig,
} from "./analytics-config";

type WindowLike = { [ANALYTICS_CONFIG_GLOBAL]?: AnalyticsRuntimeConfig };

/** Stand in for the browser global the runtime config script assigns to. */
function withWindow(config?: Partial<AnalyticsRuntimeConfig>): void {
  const value: WindowLike = config
    ? {
        [ANALYTICS_CONFIG_GLOBAL]: {
          posthog: null,
          googleAnalytics: null,
          cookieConsent: { enabled: false, policyUrl: "" },
          ...config,
        },
      }
    : {};
  (globalThis as { window?: WindowLike }).window = value;
}

describe("analytics-config", () => {
  afterEach(() => {
    delete (globalThis as { window?: WindowLike }).window;
  });

  describe("readCookieConsentRuntimeConfig", () => {
    it("is disabled server-side, where there is no injected config", () => {
      expect(readCookieConsentRuntimeConfig()).toEqual({
        enabled: false,
        policyUrl: DEFAULT_COOKIE_POLICY_URL,
      });
    });

    it("is disabled when the config script never ran (desktop static export)", () => {
      withWindow();

      expect(readCookieConsentRuntimeConfig().enabled).toBe(false);
    });

    it("is disabled when the chart leaves it at its default", () => {
      withWindow({
        cookieConsent: { enabled: false, policyUrl: "https://x.example/p/" },
      });

      expect(readCookieConsentRuntimeConfig().enabled).toBe(false);
    });

    it("reads the enabled flag and policy URL the deployment injected", () => {
      withWindow({
        cookieConsent: {
          enabled: true,
          policyUrl: "https://demo.example/privacy/",
        },
      });

      expect(readCookieConsentRuntimeConfig()).toEqual({
        enabled: true,
        policyUrl: "https://demo.example/privacy/",
      });
    });

    it("falls back to the published policy when no URL was configured", () => {
      withWindow({ cookieConsent: { enabled: true, policyUrl: "" } });

      expect(readCookieConsentRuntimeConfig().policyUrl).toBe(
        DEFAULT_COOKIE_POLICY_URL,
      );
    });
  });

  describe("readPostHogRuntimeConfig", () => {
    it("prefers the injected config over build-time env vars", () => {
      withWindow({
        posthog: {
          token: "phc_injected",
          apiHost: "/classifyre-usr",
          uiHost: "https://eu.posthog.com",
        },
      });

      expect(readPostHogRuntimeConfig()?.token).toBe("phc_injected");
    });

    it("returns null when neither a token nor a config is available", () => {
      withWindow();

      expect(readPostHogRuntimeConfig()).toBeNull();
    });
  });
});
