import { MockSource } from "./types";

export const mockSources: MockSource[] = [
  {
    id: "source-1",
    name: "My Project Files",
    type: "filesystem",
    path: "/home/user/projects",
    status: "healthy",
    lastScan: new Date(Date.now() - 2 * 60 * 60 * 1000),
    fileCount: 1240,
    findingCount: 3,
    config: {
      recursive: true,
      exclude_patterns: ["node_modules/", ".git/"],
    },
  },
  {
    id: "source-2",
    name: "GitHub: company-repo",
    type: "github",
    path: "github.com/acme/app",
    status: "healthy",
    lastScan: new Date(Date.now() - 24 * 60 * 60 * 1000),
    fileCount: 856,
    findingCount: 12,
    config: {
      repository: "acme/app",
      branch: "main",
    },
  },
  {
    id: "source-6",
    name: "WordPress: Company Blog",
    type: "wordpress",
    path: "blog.company.com",
    status: "pending",
    lastScan: undefined,
    fileCount: 0,
    findingCount: 0,
    config: {
      url: "https://blog.company.com",
    },
  },
  {
    id: "source-7",
    name: "Slack: Engineering",
    type: "slack",
    path: "acme.slack.com",
    status: "healthy",
    lastScan: new Date(Date.now() - 4 * 60 * 60 * 1000),
    fileCount: 1200,
    findingCount: 4,
    config: {
      channel_types: ["public_channel", "private_channel"],
    },
  },
  {
    id: "source-8",
    name: "Website Index: Marketing Site",
    type: "sitemap",
    path: "www.example.com/sitemap.xml",
    status: "healthy",
    lastScan: new Date(Date.now() - 6 * 60 * 60 * 1000),
    fileCount: 340,
    findingCount: 2,
    config: {
      sitemap_url: "https://www.example.com/sitemap.xml",
    },
  },
];

export function getMockSources(filters?: {
  status?: MockSource["status"];
  type?: MockSource["type"];
}): MockSource[] {
  let filtered = [...mockSources];

  if (filters?.status) {
    filtered = filtered.filter((s) => s.status === filters.status);
  }

  if (filters?.type) {
    filtered = filtered.filter((s) => s.type === filters.type);
  }

  return filtered;
}

export function getMockSourceById(id: string): MockSource | undefined {
  return mockSources.find((s) => s.id === id);
}
