/**
 * Bug 3 fix: normaliseRulesetSection converts old-format ruleset rules to the
 * canonical format expected by the CLI's Pydantic model (extra='forbid').
 *
 * Old AI-assistant format:
 *   regex_rules   → { label, pattern, case_sensitive }
 *   keyword_rules → { keyword (singular), weight, case_sensitive }
 *
 * CLI expects:
 *   regex_rules   → { id, name, pattern, flags }          (no label, no case_sensitive)
 *   keyword_rules → { id, name, keywords (list), case_sensitive }  (no keyword, no weight)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Replicate normalizeRulesetSection in isolation (no NestJS DI)
// ─────────────────────────────────────────────────────────────────────────────

function normalizeRulesetSection(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const regexRules = Array.isArray(raw.regex_rules)
    ? (raw.regex_rules as Array<Record<string, unknown>>).map((rule, i) => {
        const out: Record<string, unknown> = { ...rule };
        const label = typeof out.label === 'string' ? out.label : `rule_${i}`;
        if (!out.id) out.id = label;
        if (!out.name) out.name = label;
        if (out.flags === undefined || out.flags === null) {
          out.flags = out.case_sensitive ? '' : 'i';
        }
        delete out.label;
        delete out.case_sensitive;
        return out;
      })
    : raw.regex_rules;

  const keywordRules = Array.isArray(raw.keyword_rules)
    ? (raw.keyword_rules as Array<Record<string, unknown>>).map((rule, i) => {
        const out: Record<string, unknown> = { ...rule };
        if (!Array.isArray(out.keywords)) {
          const single = typeof out.keyword === 'string' ? out.keyword : null;
          out.keywords = single ? [single] : [];
        }
        const derived =
          (typeof out.label === 'string' ? out.label : null) ??
          (Array.isArray(out.keywords) && typeof out.keywords[0] === 'string'
            ? out.keywords[0]
            : null) ??
          `rule_${i}`;
        if (!out.id) out.id = derived;
        if (!out.name) out.name = derived;
        delete out.label;
        delete out.keyword;
        delete out.weight;
        return out;
      })
    : raw.keyword_rules;

  return {
    ...raw,
    ...(regexRules !== undefined ? { regex_rules: regexRules } : {}),
    ...(keywordRules !== undefined ? { keyword_rules: keywordRules } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// regex_rules normalisation
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeRulesetSection — regex_rules (Bug 3)', () => {
  it('converts label → id and name', () => {
    const result = normalizeRulesetSection({
      regex_rules: [
        { label: 'passive_voice', pattern: '\\bwas\\b', case_sensitive: false },
      ],
      keyword_rules: [],
    });
    const rule = (result.regex_rules as Record<string, unknown>[])[0];
    expect(rule.id).toBe('passive_voice');
    expect(rule.name).toBe('passive_voice');
  });

  it('removes label (extra-forbidden in CLI)', () => {
    const result = normalizeRulesetSection({
      regex_rules: [{ label: 'foo', pattern: 'x', case_sensitive: false }],
      keyword_rules: [],
    });
    const rule = (result.regex_rules as Record<string, unknown>[])[0];
    expect(rule.label).toBeUndefined();
  });

  it('removes case_sensitive (extra-forbidden in regex_rules)', () => {
    const result = normalizeRulesetSection({
      regex_rules: [{ label: 'foo', pattern: 'x', case_sensitive: false }],
      keyword_rules: [],
    });
    const rule = (result.regex_rules as Record<string, unknown>[])[0];
    expect(rule.case_sensitive).toBeUndefined();
  });

  it('case_sensitive: false → flags: "i"', () => {
    const result = normalizeRulesetSection({
      regex_rules: [{ label: 'foo', pattern: 'x', case_sensitive: false }],
      keyword_rules: [],
    });
    const rule = (result.regex_rules as Record<string, unknown>[])[0];
    expect(rule.flags).toBe('i');
  });

  it('case_sensitive: true → flags: ""', () => {
    const result = normalizeRulesetSection({
      regex_rules: [{ label: 'bar', pattern: 'y', case_sensitive: true }],
      keyword_rules: [],
    });
    const rule = (result.regex_rules as Record<string, unknown>[])[0];
    expect(rule.flags).toBe('');
  });

  it('preserves existing flags (no overwrite)', () => {
    const result = normalizeRulesetSection({
      regex_rules: [{ id: 'r1', name: 'R1', pattern: 'z', flags: 'im' }],
      keyword_rules: [],
    });
    const rule = (result.regex_rules as Record<string, unknown>[])[0];
    expect(rule.flags).toBe('im');
  });

  it('preserves existing id + name (no overwrite)', () => {
    const result = normalizeRulesetSection({
      regex_rules: [
        {
          id: 'existing-id',
          name: 'Existing',
          label: 'ignored',
          pattern: 'a',
          case_sensitive: false,
        },
      ],
      keyword_rules: [],
    });
    const rule = (result.regex_rules as Record<string, unknown>[])[0];
    expect(rule.id).toBe('existing-id');
    expect(rule.name).toBe('Existing');
  });

  it('falls back to rule_<index> when label is absent', () => {
    const result = normalizeRulesetSection({
      regex_rules: [{ pattern: 'x', case_sensitive: false }],
      keyword_rules: [],
    });
    const rule = (result.regex_rules as Record<string, unknown>[])[0];
    expect(rule.id).toBe('rule_0');
    expect(rule.name).toBe('rule_0');
  });

  it('preserves pattern unchanged', () => {
    const pattern = '\\b(foo|bar)\\b';
    const result = normalizeRulesetSection({
      regex_rules: [{ label: 'x', pattern, case_sensitive: false }],
      keyword_rules: [],
    });
    const rule = (result.regex_rules as Record<string, unknown>[])[0];
    expect(rule.pattern).toBe(pattern);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// keyword_rules normalisation
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeRulesetSection — keyword_rules (Bug 3)', () => {
  it('converts singular keyword → keywords list', () => {
    const result = normalizeRulesetSection({
      regex_rules: [],
      keyword_rules: [
        { keyword: 'Reuters', weight: 0.9, case_sensitive: true },
      ],
    });
    const rule = (result.keyword_rules as Record<string, unknown>[])[0];
    expect(Array.isArray(rule.keywords)).toBe(true);
    expect((rule.keywords as string[])[0]).toBe('Reuters');
  });

  it('removes singular keyword field', () => {
    const result = normalizeRulesetSection({
      regex_rules: [],
      keyword_rules: [
        { keyword: 'Reuters', weight: 0.9, case_sensitive: true },
      ],
    });
    const rule = (result.keyword_rules as Record<string, unknown>[])[0];
    expect(rule.keyword).toBeUndefined();
  });

  it('removes weight (extra-forbidden)', () => {
    const result = normalizeRulesetSection({
      regex_rules: [],
      keyword_rules: [
        { keyword: 'Reuters', weight: 0.9, case_sensitive: true },
      ],
    });
    const rule = (result.keyword_rules as Record<string, unknown>[])[0];
    expect(rule.weight).toBeUndefined();
  });

  it('derives id and name from keyword value', () => {
    const result = normalizeRulesetSection({
      regex_rules: [],
      keyword_rules: [
        { keyword: 'Reuters', weight: 0.9, case_sensitive: true },
      ],
    });
    const rule = (result.keyword_rules as Record<string, unknown>[])[0];
    expect(rule.id).toBe('Reuters');
    expect(rule.name).toBe('Reuters');
  });

  it('derives id and name from label when present', () => {
    const result = normalizeRulesetSection({
      regex_rules: [],
      keyword_rules: [
        {
          label: 'news_source',
          keyword: 'Reuters',
          weight: 0.9,
          case_sensitive: true,
        },
      ],
    });
    const rule = (result.keyword_rules as Record<string, unknown>[])[0];
    expect(rule.id).toBe('news_source');
    expect(rule.name).toBe('news_source');
    expect(rule.label).toBeUndefined();
  });

  it('preserves existing keywords list unchanged', () => {
    const result = normalizeRulesetSection({
      regex_rules: [],
      keyword_rules: [
        {
          id: 'k1',
          name: 'K1',
          keywords: ['Reuters', 'AP'],
          case_sensitive: true,
        },
      ],
    });
    const rule = (result.keyword_rules as Record<string, unknown>[])[0];
    expect(rule.keywords).toEqual(['Reuters', 'AP']);
  });

  it('preserves case_sensitive (valid field for keyword rules)', () => {
    const result = normalizeRulesetSection({
      regex_rules: [],
      keyword_rules: [
        { keyword: 'reuters', weight: 0.5, case_sensitive: false },
      ],
    });
    const rule = (result.keyword_rules as Record<string, unknown>[])[0];
    expect(rule.case_sensitive).toBe(false);
  });

  it('falls back to rule_<index> when no label or keyword', () => {
    const result = normalizeRulesetSection({
      regex_rules: [],
      keyword_rules: [{ keywords: ['foo'], case_sensitive: false }],
    });
    const rule = (result.keyword_rules as Record<string, unknown>[])[0];
    expect(rule.id).toBe('foo'); // first keyword
    expect(rule.name).toBe('foo');
  });

  it('passes through unknown top-level ruleset fields', () => {
    const result = normalizeRulesetSection({
      regex_rules: [],
      keyword_rules: [],
      min_score: 0.5,
    });
    expect(result.min_score).toBe(0.5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// real-world snapshot: ai_writing_indicators detector config
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeRulesetSection — real-world snapshot (ai_writing_indicators)', () => {
  const rawRuleset = {
    regex_rules: [
      {
        label: 'ai_hedge_phrase',
        pattern: '\\b(it is important to note)\\b',
        case_sensitive: false,
      },
      {
        label: 'ai_transition_boilerplate',
        pattern: '\\b(furthermore|moreover)\\b',
        case_sensitive: false,
      },
    ],
    keyword_rules: [
      {
        weight: 0.9,
        keyword: 'Reuters',
        case_sensitive: true,
      },
    ],
  };

  it('all regex_rules have id, name, flags and no label or case_sensitive', () => {
    const result = normalizeRulesetSection(rawRuleset);
    for (const rule of result.regex_rules as Record<string, unknown>[]) {
      expect(typeof rule.id).toBe('string');
      expect(typeof rule.name).toBe('string');
      expect(typeof rule.flags).toBe('string');
      expect(rule.label).toBeUndefined();
      expect(rule.case_sensitive).toBeUndefined();
    }
  });

  it('all keyword_rules have id, name, keywords[] and no weight or keyword (singular)', () => {
    const result = normalizeRulesetSection(rawRuleset);
    for (const rule of result.keyword_rules as Record<string, unknown>[]) {
      expect(typeof rule.id).toBe('string');
      expect(typeof rule.name).toBe('string');
      expect(Array.isArray(rule.keywords)).toBe(true);
      expect(rule.weight).toBeUndefined();
      expect(rule.keyword).toBeUndefined();
    }
  });
});
