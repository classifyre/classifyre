import {
  aiProviderEndpointKey,
  normalizeProviderBaseUrl,
  providerStoredKeyIsKept,
} from "./ai-provider";

describe("ai provider endpoint key", () => {
  it("normalises the base URL (trim, trailing slashes, lowercase; null and empty are equal)", () => {
    expect(normalizeProviderBaseUrl(null)).toBe("");
    expect(normalizeProviderBaseUrl(undefined)).toBe("");
    expect(normalizeProviderBaseUrl("")).toBe("");
    expect(normalizeProviderBaseUrl("   ")).toBe("");
    expect(
      aiProviderEndpointKey(
        "OPENAI_COMPATIBLE",
        "https://Gateway.example.test/v1/",
      ),
    ).toBe("OPENAI_COMPATIBLE|https://gateway.example.test/v1");
    expect(aiProviderEndpointKey("CLAUDE", null)).toBe(
      aiProviderEndpointKey("CLAUDE", ""),
    );
  });

  it("keeps the stored key across changes that leave the endpoint alone", () => {
    const draft = {
      provider: "OPENAI_COMPATIBLE",
      baseUrl: "https://gateway.example.test",
      apiKey: "",
      hasStoredKey: true,
      storedEndpoint: aiProviderEndpointKey(
        "OPENAI_COMPATIBLE",
        "https://gateway.example.test",
      ),
    };
    expect(providerStoredKeyIsKept(draft)).toBe(true);
    expect(
      providerStoredKeyIsKept({
        ...draft,
        baseUrl: "https://gateway.example.test/",
      }),
    ).toBe(true);
  });

  it("drops the stored key when the provider or base URL changes", () => {
    const draft = {
      provider: "OPENAI_COMPATIBLE",
      baseUrl: "https://gateway.example.test",
      apiKey: "",
      hasStoredKey: true,
      storedEndpoint: aiProviderEndpointKey(
        "OPENAI_COMPATIBLE",
        "https://gateway.example.test",
      ),
    };
    expect(
      providerStoredKeyIsKept({
        ...draft,
        baseUrl: "https://collector.example.test",
      }),
    ).toBe(false);
    expect(
      providerStoredKeyIsKept({ ...draft, provider: "CLAUDE", baseUrl: "" }),
    ).toBe(false);
  });
});
