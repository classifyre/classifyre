/**
 * Default glossary terms that map business concepts to technical detector filters.
 * These are seeded on first run and can be customized by users.
 */
export const DEFAULT_GLOSSARY_TERMS = [
  {
    displayName: 'Security Threats',
    description:
      'All findings related to security vulnerabilities including exposed secrets, malware signatures, and prompt injection attempts.',
    category: 'Security',
    filterMapping: {
      detectorTypes: ['SECRETS', 'YARA', 'PROMPT_INJECTION', 'CODE_SECURITY'],
    },
    color: '#ff2b2b',
    icon: 'shield-alert',
  },
  {
    displayName: 'PII Exposure',
    description:
      'Personal Identifiable Information detected in scanned content, including names, emails, SSNs, phone numbers, and health records.',
    category: 'Privacy',
    filterMapping: {
      detectorTypes: ['PII', 'OCR_PII', 'DEID_SCORE'],
    },
    color: '#f59e0b',
    icon: 'user-x',
  },
  {
    displayName: 'Compliance Violations',
    description:
      'Findings that indicate potential regulatory non-compliance including GDPR, HIPAA, PCI-DSS, and jurisdiction-specific violations.',
    category: 'Compliance',
    filterMapping: {
      detectorTypes: ['SENSITIVITY_TIER', 'JURISDICTION_TAG'],
    },
    color: '#8b5cf6',
    icon: 'scale',
  },
  {
    displayName: 'Content Safety Issues',
    description:
      'Toxic, NSFW, biased, hateful, or otherwise inappropriate content detected in scanned sources.',
    category: 'Content Safety',
    filterMapping: {
      detectorTypes: ['TOXIC', 'NSFW', 'BIAS', 'HATE_SPEECH', 'IMAGE_VIOLENCE'],
    },
    color: '#ef4444',
    icon: 'alert-triangle',
  },
  {
    displayName: 'Critical Findings',
    description:
      'All findings with CRITICAL severity level, regardless of detector type. These require immediate attention.',
    category: 'Severity',
    filterMapping: {
      severities: ['CRITICAL'],
    },
    color: '#dc2626',
    icon: 'flame',
  },
  {
    displayName: 'Unresolved Issues',
    description:
      'All findings that are currently open and have not been resolved, marked as false positive, or ignored.',
    category: 'Status',
    filterMapping: {
      statuses: ['OPEN'],
    },
    color: '#0ea5e9',
    icon: 'circle-dot',
  },
  {
    displayName: 'Data Quality Issues',
    description:
      'Findings related to data quality including broken links, duplicates, stale content, and content quality issues.',
    category: 'Quality',
    filterMapping: {
      detectorTypes: [
        'BROKEN_LINKS',
        'DUPLICATE',
        'CONTENT_QUALITY',
        'SPAM',
        'PLAGIARISM',
      ],
    },
    color: '#06b6d4',
    icon: 'database',
  },
];
