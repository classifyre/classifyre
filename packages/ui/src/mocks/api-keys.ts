import { MockApiKey } from "./types";

export const mockApiKeys: MockApiKey[] = [
  {
    id: "key-1",
    name: "Production API Key",
    keyPrefix: "classifyre_live_",
    createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
    lastUsedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
    expiresAt: undefined,
    usageCount: 1247,
    isActive: true,
  },
  {
    id: "key-2",
    name: "Development Key",
    keyPrefix: "classifyre_dev_",
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
    lastUsedAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
    usageCount: 342,
    isActive: true,
  },
  {
    id: "key-3",
    name: "CI/CD Integration",
    keyPrefix: "classifyre_cicd_",
    createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), // 60 days ago
    lastUsedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // 90 days ago
    expiresAt: undefined,
    usageCount: 89,
    isActive: false,
  },
];

export function getMockApiKeys(filters?: { isActive?: boolean }): MockApiKey[] {
  let filtered = [...mockApiKeys];

  if (filters?.isActive !== undefined) {
    filtered = filtered.filter((k) => k.isActive === filters.isActive);
  }

  return filtered;
}

export function getMockApiKeyById(id: string): MockApiKey | undefined {
  return mockApiKeys.find((k) => k.id === id);
}
