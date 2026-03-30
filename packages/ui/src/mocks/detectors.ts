import { MockDetector } from "./types";

export const mockDetectors: MockDetector[] = [
  {
    id: "aws-access-key",
    name: "AWS Access Keys",
    description: "Detects AWS access key IDs and secret keys",
    category: "security",
    severity: "critical",
    patternCount: 3,
    accuracy: 95,
    enabled: true,
    config: {
      patterns: ["AKIA[0-9A-Z]{16}", "ASIA[0-9A-Z]{16}"],
    },
  },
  {
    id: "private-key",
    name: "Private Keys",
    description: "Detects SSH, SSL, and other private keys",
    category: "security",
    severity: "critical",
    patternCount: 5,
    accuracy: 99,
    enabled: true,
    config: {
      patterns: ["BEGIN RSA PRIVATE KEY", "BEGIN OPENSSH PRIVATE KEY"],
    },
  },
  {
    id: "database-credentials",
    name: "Database Credentials",
    description: "Detects database connection strings",
    category: "security",
    severity: "high",
    patternCount: 8,
    accuracy: 90,
    enabled: false,
    config: {
      patterns: ["postgres://", "mysql://", "mongodb://"],
    },
  },
  {
    id: "credit-card",
    name: "Credit Card Numbers",
    description: "Detects Visa, Mastercard, Amex with Luhn validation",
    category: "privacy",
    severity: "critical",
    patternCount: 3,
    accuracy: 95,
    enabled: true,
    config: {
      patterns: ["4\\d{3}[-\\s]?\\d{4}[-\\s]?\\d{4}[-\\s]?\\d{4}"],
    },
  },
  {
    id: "us-ssn",
    name: "US Social Security Numbers",
    description: "Detects SSNs with area code validation",
    category: "privacy",
    severity: "high",
    patternCount: 2,
    accuracy: 85,
    enabled: true,
    config: {
      patterns: ["\\d{3}[-\\s]?\\d{2}[-\\s]?\\d{4}"],
    },
  },
  {
    id: "email-address",
    name: "Email Addresses",
    description: "Detects email addresses",
    category: "privacy",
    severity: "medium",
    patternCount: 1,
    accuracy: 90,
    enabled: true,
    config: {
      patterns: ["[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}"],
    },
  },
  {
    id: "api-key",
    name: "Generic API Keys",
    description: "Detects common API key patterns",
    category: "security",
    severity: "high",
    patternCount: 12,
    accuracy: 88,
    enabled: true,
    config: {
      patterns: ["api[_-]?key[=:]\\s*['\"]?[A-Za-z0-9]{20,}"],
    },
  },
  {
    id: "password",
    name: "Password Detection",
    description: "Detects hardcoded passwords",
    category: "security",
    severity: "critical",
    patternCount: 6,
    accuracy: 82,
    enabled: true,
    config: {
      patterns: ["password[=:]\\s*['\"]?[^\\s]{8,}"],
    },
  },
  {
    id: "gcp-key",
    name: "GCP Service Account Key",
    description: "Detects Google Cloud Platform service account keys",
    category: "security",
    severity: "critical",
    patternCount: 2,
    accuracy: 97,
    enabled: true,
    config: {
      patterns: ['"type":\\s*"service_account"'],
    },
  },
  {
    id: "azure-key",
    name: "Azure Storage Key",
    description: "Detects Azure storage account keys",
    category: "security",
    severity: "critical",
    patternCount: 3,
    accuracy: 94,
    enabled: true,
    config: {
      patterns: ["AccountKey[=:]\\s*['\"]?[A-Za-z0-9+/=]{86,}"],
    },
  },
];

export function getMockDetectors(filters?: {
  category?: string;
  enabled?: boolean;
}): MockDetector[] {
  let filtered = [...mockDetectors];

  if (filters?.category) {
    filtered = filtered.filter((d) => d.category === filters.category);
  }

  if (filters?.enabled !== undefined) {
    filtered = filtered.filter((d) => d.enabled === filters.enabled);
  }

  return filtered;
}

export function getMockDetectorById(id: string): MockDetector | undefined {
  return mockDetectors.find((d) => d.id === id);
}
