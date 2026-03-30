import { MockReport } from "./types";

export const mockReports: MockReport[] = [
  {
    id: "report-1",
    name: "Weekly Security Report",
    type: "security",
    format: "pdf",
    generatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
    findings: 15,
    sources: 2,
    fileSize: 2450000, // 2.45 MB
    downloadUrl: "/api/reports/report-1/download",
  },
  {
    id: "report-2",
    name: "Compliance Audit Report",
    type: "compliance",
    format: "pdf",
    generatedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
    findings: 8,
    sources: 3,
    fileSize: 1890000, // 1.89 MB
    downloadUrl: "/api/reports/report-2/download",
  },
  {
    id: "report-3",
    name: "Monthly Summary",
    type: "summary",
    format: "pdf",
    generatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
    findings: 127,
    sources: 3,
    fileSize: 5120000, // 5.12 MB
    downloadUrl: "/api/reports/report-3/download",
  },
  {
    id: "report-4",
    name: "Executive Dashboard Export",
    type: "executive",
    format: "csv",
    generatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
    findings: 45,
    sources: 2,
    fileSize: 125000, // 125 KB
    downloadUrl: "/api/reports/report-4/download",
  },
];

export function getMockReports(filters?: {
  type?: MockReport["type"];
  format?: MockReport["format"];
}): MockReport[] {
  let filtered = [...mockReports];

  if (filters?.type) {
    filtered = filtered.filter((r) => r.type === filters.type);
  }

  if (filters?.format) {
    filtered = filtered.filter((r) => r.format === filters.format);
  }

  return filtered;
}

export function getMockReportById(id: string): MockReport | undefined {
  return mockReports.find((r) => r.id === id);
}
