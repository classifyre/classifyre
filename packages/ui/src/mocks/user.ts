import { MockUser, MockUserPreferences } from "./types";

export const mockUser: MockUser = {
  id: "user-1",
  email: "sarah.security@example.com",
  name: "Sarah Chen",
  role: "security",
  avatar: undefined,
  createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // 90 days ago
  lastLoginAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
};

export const mockUserPreferences: MockUserPreferences = {
  userId: "user-1",
  theme: "system",
  emailNotifications: {
    criticalFindings: true,
    highFindings: true,
    mediumLowFindings: false,
    scanCompletion: true,
    sourceFailures: true,
    weeklyDigest: true,
  },
  slackIntegration: {
    enabled: false,
    webhookUrl: "",
    channels: {
      criticalFindings: "",
      dailySummary: "",
    },
  },
};

export function getMockUser(): MockUser {
  return mockUser;
}

export function getMockUserPreferences(): MockUserPreferences {
  return mockUserPreferences;
}
