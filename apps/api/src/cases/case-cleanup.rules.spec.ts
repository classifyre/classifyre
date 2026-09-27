import {
  anyRule,
  assetRemoval,
  compileFindingFilters,
  filterPatternProblem,
  findingRemoval,
  firstMatchingFilter,
  newlyEnabled,
  NO_CLEANUP,
  retiredBySystem,
  type CleanupRules,
} from './case-cleanup.rules';

const ALL: CleanupRules = {
  removeGoneFindings: true,
  removeResolvedFindings: true,
  removeGoneAssets: true,
};

describe('case clean-up rules', () => {
  describe('findingRemoval', () => {
    it('takes nothing out with every switch off', () => {
      expect(findingRemoval(null, NO_CLEANUP)).toBeNull();
      expect(
        findingRemoval(
          { status: 'RESOLVED', resolutionReason: 'Fixed upstream' },
          NO_CLEANUP,
        ),
      ).toBeNull();
    });

    it('calls a deleted finding gone', () => {
      expect(findingRemoval(null, ALL)).toEqual({
        reason: 'FINDING_GONE',
        state: 'DELETED',
      });
      expect(
        findingRemoval(null, { ...ALL, removeGoneFindings: false }),
      ).toBeNull();
    });

    it("calls a scan's retirement gone, not resolved", () => {
      const retired = {
        status: 'RESOLVED',
        resolutionReason: 'Detection no longer present in scan',
      };
      expect(findingRemoval(retired, ALL)).toEqual({
        reason: 'FINDING_GONE',
        state: 'RETIRED',
      });
      // Only the resolved switch on: a scan's retirement is not a resolve.
      expect(
        findingRemoval(retired, {
          ...NO_CLEANUP,
          removeResolvedFindings: true,
        }),
      ).toBeNull();
    });

    it("calls a person's resolve resolved, whatever they wrote", () => {
      for (const resolutionReason of [null, 'Manual status change', 'dup']) {
        expect(
          findingRemoval({ status: 'RESOLVED', resolutionReason }, ALL),
        ).toEqual({ reason: 'FINDING_RESOLVED' });
        expect(
          findingRemoval(
            { status: 'RESOLVED', resolutionReason },
            { ...NO_CLEANUP, removeGoneFindings: true },
          ),
        ).toBeNull();
      }
    });

    it('never touches open, false-positive or ignored findings', () => {
      for (const status of ['OPEN', 'FALSE_POSITIVE', 'IGNORED']) {
        expect(
          findingRemoval({ status, resolutionReason: null }, ALL),
        ).toBeNull();
      }
    });
  });

  describe('retiredBySystem', () => {
    it('knows every reason the platform writes for itself', () => {
      expect(retiredBySystem('Detection no longer present in scan')).toBe(true);
      expect(retiredBySystem('Asset deleted from source (full scan)')).toBe(
        true,
      );
      expect(
        retiredBySystem('Detector removed from source configuration'),
      ).toBe(true);
      expect(retiredBySystem('Uploaded source file deleted')).toBe(true);
      expect(
        retiredBySystem(
          'Out of scope for de_permits: asset kind "image" is outside its scope',
        ),
      ).toBe(true);
    });

    it('does not mistake a person for the platform', () => {
      expect(retiredBySystem(null)).toBe(false);
      expect(retiredBySystem('Bulk status change')).toBe(false);
      expect(retiredBySystem('out of scope for me')).toBe(false);
    });
  });

  describe('assetRemoval', () => {
    it('takes out deleted assets only when asked', () => {
      expect(assetRemoval(null, ALL)).toBe('DELETED');
      expect(assetRemoval({ status: 'DELETED' }, ALL)).toBe('RETIRED');
      expect(assetRemoval({ status: 'UPDATED' }, ALL)).toBeNull();
      expect(
        assetRemoval(null, { ...ALL, removeGoneAssets: false }),
      ).toBeNull();
    });
  });

  describe('newlyEnabled / anyRule', () => {
    it('names only the switches turned on', () => {
      const before = { ...NO_CLEANUP, removeGoneFindings: true };
      const after = { ...ALL, removeGoneAssets: false };
      expect(newlyEnabled(before, after)).toEqual({
        removeGoneFindings: false,
        removeResolvedFindings: true,
        removeGoneAssets: false,
      });
      expect(anyRule(newlyEnabled(after, before))).toBe(false);
      expect(anyRule(NO_CLEANUP)).toBe(false);
    });
  });

  describe('finding filters', () => {
    const filters = compileFindingFilters([
      {
        id: 't',
        kind: 'FINDING_TYPE',
        pattern: 'IP_ADDRESS',
        caseInquiryId: null,
      },
      {
        id: 'v',
        kind: 'VALUE_PATTERN',
        pattern: '^10\\.',
        caseInquiryId: null,
      },
      { id: 'bad', kind: 'VALUE_PATTERN', pattern: '(', caseInquiryId: null },
    ]);

    it('matches a type exactly and a value by regex', () => {
      expect(
        firstMatchingFilter(
          { findingType: 'IP_ADDRESS', matchedContent: '8.8.8.8' },
          filters,
        )?.rule.id,
      ).toBe('t');
      expect(
        firstMatchingFilter(
          { findingType: 'URL', matchedContent: '10.0.0.4' },
          filters,
        )?.rule.id,
      ).toBe('v');
      expect(
        firstMatchingFilter(
          { findingType: 'IP_ADDRESS_V6', matchedContent: '::1' },
          filters,
        ),
      ).toBeNull();
    });

    it('never lets a broken pattern match everything', () => {
      const [broken] = compileFindingFilters([
        { id: 'bad', kind: 'VALUE_PATTERN', pattern: '(', caseInquiryId: null },
      ]);
      expect(broken.test({ findingType: 'X', matchedContent: '(' })).toBe(
        false,
      );
    });

    it('reads a missing value as empty', () => {
      const [empty] = compileFindingFilters([
        { id: 'e', kind: 'VALUE_PATTERN', pattern: '^$', caseInquiryId: null },
      ]);
      expect(empty.test({ findingType: 'X', matchedContent: null })).toBe(true);
    });

    it('explains a pattern it cannot save', () => {
      expect(filterPatternProblem('VALUE_PATTERN', '(')).toMatch(
        /Not a valid regular expression/,
      );
      expect(filterPatternProblem('FINDING_TYPE', '   ')).toMatch(/empty/);
      expect(filterPatternProblem('VALUE_PATTERN', 'x'.repeat(501))).toMatch(
        /longer than 500/,
      );
      expect(filterPatternProblem('FINDING_TYPE', '(')).toBeNull();
      expect(filterPatternProblem('VALUE_PATTERN', '^a+$')).toBeNull();
    });
  });
});
