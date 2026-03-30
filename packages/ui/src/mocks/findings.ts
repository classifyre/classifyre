import { MockFinding } from "./types";

export const mockFindings: MockFinding[] = [
  {
    id: "finding-1",
    severity: "critical",
    status: "open",
    detectorId: "aws-access-key",
    detectorName: "AWS Access Key Detector",
    category: "security",
    message: "AWS Access Key detected",
    filePath: "config/aws-credentials.js",
    lineNumber: 15,
    columnStart: 12,
    columnEnd: 35,
    matchedContent: "AKIAIOSFODNN7EXAMPLE",
    contextBefore: "// AWS Configuration\nconst config = {",
    contextAfter: "AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7...'",
    sourceType: "filesystem",
    sourceName: "My Project Files",
    confidence: 0.95,
    detectedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
    metadata: {
      pattern_name: "aws_access_key_id",
    },
  },
  {
    id: "finding-2",
    severity: "high",
    status: "open",
    detectorId: "private-key",
    detectorName: "Private Key Detector",
    category: "security",
    message: "Private Key detected",
    filePath: "deploy/keys.pem",
    lineNumber: 1,
    columnStart: 0,
    columnEnd: 27,
    matchedContent: "-----BEGIN RSA PRIVATE KEY-----",
    contextBefore: "",
    contextAfter:
      "MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy0AHB7MhgwMbRvI0MBZhpI",
    sourceType: "github",
    sourceName: "GitHub: company-repo",
    confidence: 0.99,
    detectedAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
    metadata: {
      pattern_name: "rsa_private_key",
    },
  },
  {
    id: "finding-3",
    severity: "medium",
    status: "open",
    detectorId: "email-address",
    detectorName: "Email Address Detector",
    category: "privacy",
    message: "Email Address detected",
    filePath: "README.md",
    lineNumber: 42,
    columnStart: 10,
    columnEnd: 30,
    matchedContent: "contact@company.com",
    contextBefore: "For support, email us at",
    contextAfter: "or visit our website.",
    sourceType: "filesystem",
    sourceName: "My Project Files",
    confidence: 0.9,
    detectedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    metadata: {
      pattern_name: "email",
    },
  },
  {
    id: "finding-4",
    severity: "critical",
    status: "resolved",
    detectorId: "credit-card",
    detectorName: "Credit Card Detector",
    category: "privacy",
    message: "Credit Card Number detected",
    filePath: "test/fixtures/payment.json",
    lineNumber: 8,
    columnStart: 15,
    columnEnd: 34,
    matchedContent: "4111-1111-1111-1111",
    contextBefore: '"cardNumber":',
    contextAfter: '"cvv": "123"',
    sourceType: "filesystem",
    sourceName: "My Project Files",
    confidence: 0.9,
    detectedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
    resolvedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
    metadata: {
      pattern_name: "visa",
    },
  },
  {
    id: "finding-5",
    severity: "high",
    status: "new",
    detectorId: "us-ssn",
    detectorName: "US Social Security Number Detector",
    category: "privacy",
    message: "US SSN detected",
    filePath: "docs/employee-data.md",
    lineNumber: 23,
    columnStart: 5,
    columnEnd: 16,
    matchedContent: "123-45-6789",
    contextBefore: "Employee ID:",
    contextAfter: "Department: Engineering",
    sourceType: "wordpress",
    sourceName: "WordPress: Engineering Docs",
    confidence: 0.85,
    detectedAt: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago
    metadata: {
      pattern_name: "ssn_formatted",
    },
  },
  {
    id: "finding-6",
    severity: "low",
    status: "open",
    detectorId: "email-address",
    detectorName: "Email Address Detector",
    category: "privacy",
    message: "Email Address detected",
    filePath: "src/utils/helpers.ts",
    lineNumber: 45,
    columnStart: 8,
    columnEnd: 25,
    matchedContent: "support@example.com",
    contextBefore: "const supportEmail =",
    contextAfter: "// Contact support",
    sourceType: "filesystem",
    sourceName: "My Project Files",
    confidence: 0.75,
    detectedAt: new Date(Date.now() - 5 * 60 * 60 * 1000), // 5 hours ago
    metadata: {
      pattern_name: "email",
    },
  },
  {
    id: "finding-7",
    severity: "critical",
    status: "new",
    detectorId: "aws-access-key",
    detectorName: "AWS Access Key Detector",
    category: "security",
    message: "AWS Access Key detected",
    filePath: "secrets.env",
    lineNumber: 3,
    columnStart: 12,
    columnEnd: 28,
    matchedContent: "AKIAEXAMPLE123456",
    contextBefore: "AWS_ACCESS_KEY_ID=",
    contextAfter: "AWS_SECRET_ACCESS_KEY=...",
    sourceType: "github",
    sourceName: "GitHub: company-repo",
    confidence: 0.98,
    detectedAt: new Date(Date.now() - 15 * 60 * 1000), // 15 minutes ago
    metadata: {
      pattern_name: "aws_access_key_id",
    },
  },
  {
    id: "finding-8",
    severity: "medium",
    status: "false_positive",
    detectorId: "credit-card",
    detectorName: "Credit Card Detector",
    category: "privacy",
    message: "Credit Card Number detected",
    filePath: "test/data/mock-cards.txt",
    lineNumber: 1,
    columnStart: 0,
    columnEnd: 19,
    matchedContent: "4111-1111-1111-1111",
    contextBefore: "",
    contextAfter: "// Test card number",
    sourceType: "filesystem",
    sourceName: "My Project Files",
    confidence: 0.95,
    detectedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
    metadata: {
      pattern_name: "visa",
    },
  },
  {
    id: "finding-9",
    severity: "high",
    status: "ignored",
    detectorId: "private-key",
    detectorName: "Private Key Detector",
    category: "security",
    message: "Private Key detected",
    filePath: "docs/examples/example-key.pem",
    lineNumber: 1,
    columnStart: 0,
    columnEnd: 27,
    matchedContent: "-----BEGIN RSA PRIVATE KEY-----",
    contextBefore: "",
    contextAfter: "// Example key for documentation",
    sourceType: "filesystem",
    sourceName: "My Project Files",
    confidence: 0.99,
    detectedAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000), // 14 days ago
    metadata: {
      pattern_name: "rsa_private_key",
    },
  },
  {
    id: "finding-10",
    severity: "info",
    status: "open",
    detectorId: "email-address",
    detectorName: "Email Address Detector",
    category: "privacy",
    message: "Email Address detected",
    filePath: "CONTACT.md",
    lineNumber: 5,
    columnStart: 12,
    columnEnd: 28,
    matchedContent: "hello@company.com",
    contextBefore: "Email:",
    contextAfter: "Phone: +1-555-0123",
    sourceType: "github",
    sourceName: "GitHub: company-repo",
    confidence: 0.85,
    detectedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
    metadata: {
      pattern_name: "email",
    },
  },
];

export function getMockFindings(filters?: {
  severity?: string[];
  status?: string[];
  detectorId?: string;
  sourceType?: string;
  category?: string;
  search?: string;
}): MockFinding[] {
  let filtered = [...mockFindings];

  if (filters?.severity) {
    filtered = filtered.filter((f) => filters.severity!.includes(f.severity));
  }

  if (filters?.status) {
    filtered = filtered.filter((f) => filters.status!.includes(f.status));
  }

  if (filters?.detectorId) {
    filtered = filtered.filter((f) => f.detectorId === filters.detectorId);
  }

  if (filters?.sourceType) {
    filtered = filtered.filter((f) => f.sourceType === filters.sourceType);
  }

  if (filters?.category) {
    filtered = filtered.filter((f) => f.category === filters.category);
  }

  if (filters?.search) {
    const searchLower = filters.search.toLowerCase();
    filtered = filtered.filter(
      (f) =>
        f.message.toLowerCase().includes(searchLower) ||
        f.filePath.toLowerCase().includes(searchLower) ||
        f.detectorName.toLowerCase().includes(searchLower) ||
        f.sourceName.toLowerCase().includes(searchLower) ||
        f.matchedContent.toLowerCase().includes(searchLower),
    );
  }

  return filtered;
}

export function getMockFindingById(id: string): MockFinding | undefined {
  return mockFindings.find((f) => f.id === id);
}
