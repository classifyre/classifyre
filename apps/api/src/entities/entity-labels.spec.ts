import {
  canBeIdentifierLabel,
  foldKey,
  isIdentifierLabel,
  isLinkableLabel,
  nameLabelType,
  nameLabelsFor,
} from './entity-labels';

/**
 * Which labels take part in entity resolution (G5 R5). The rule that matters
 * most is the negative one: tags and free text never link, because one of
 * those values in an entity would make every document a mention.
 */
describe('entity labels', () => {
  describe('nameLabelType', () => {
    it('classifies the built-in name labels', () => {
      expect(nameLabelType('PERSON')).toBe('PERSON');
      expect(nameLabelType('organization')).toBe('ORGANIZATION');
      expect(nameLabelType('LOCATION')).toBe('LOCATION');
      expect(nameLabelType('name')).toBe('ANY');
    });

    it('recognises a prefixed label by its last word', () => {
      // GLiNER2 emits `entity:organization`, normalised to entity_organization.
      expect(nameLabelType('entity:organization')).toBe('ORGANIZATION');
      expect(nameLabelType('pii_person')).toBe('PERSON');
    });

    it('does not read a bare "name" suffix as a name', () => {
      // `file_name` and `host_name` are not people.
      expect(nameLabelType('file_name')).toBeNull();
    });

    it('honours labels declared as names', () => {
      const config = {
        nameLabels: { beneficiary: 'PERSON' as const },
        identifierLabels: [],
      };
      expect(nameLabelType('Beneficiary', config)).toBe('PERSON');
      expect(nameLabelType('beneficiary')).toBeNull();
    });

    it('never treats tags or dates as names, even when configured', () => {
      const config = {
        nameLabels: { tag_owner: 'PERSON' as const, date_time: 'ANY' as const },
        identifierLabels: ['tag_owner'],
      };
      expect(nameLabelType('tag:owner', config)).toBeNull();
      expect(nameLabelType('DATE_TIME', config)).toBeNull();
      expect(isIdentifierLabel('tag:owner', config)).toBe(false);
      expect(canBeIdentifierLabel('tag:owner')).toBe(false);
    });
  });

  describe('identifier labels', () => {
    it('knows the PII detector’s exact identifiers', () => {
      for (const label of [
        'EMAIL_ADDRESS',
        'IBAN_CODE',
        'PHONE_NUMBER',
        'US_SSN',
      ]) {
        expect(isIdentifierLabel(label)).toBe(true);
      }
    });

    it('leaves free text, URLs and unknown labels out', () => {
      expect(isLinkableLabel('URL')).toBe(false);
      expect(isLinkableLabel('NRP')).toBe(false);
      expect(isLinkableLabel('regex_at_fn')).toBe(false);
    });

    it('takes a workspace label once it is declared', () => {
      const config = { nameLabels: {}, identifierLabels: ['regex_at_fn'] };
      expect(isIdentifierLabel('regex_at_fn', config)).toBe(true);
      // An operator may file a register number under any label that is not a tag.
      expect(canBeIdentifierLabel('regex_at_fn')).toBe(true);
    });
  });

  describe('nameLabelsFor', () => {
    it('indexes an organisation under the organisation labels the workspace produces', () => {
      const labels = nameLabelsFor('ORGANIZATION', [
        'person',
        'entity_organization',
        'name',
        'email_address',
      ]);
      expect(labels).toEqual(['entity_organization', 'name']);
    });

    it('adds no label nothing produces', () => {
      // Rows under labels no detector emits would only clutter the entity.
      expect(nameLabelsFor('PERSON', [])).toEqual([]);
      expect(nameLabelsFor('PERSON', ['person'])).toEqual(['person']);
    });

    it('gives an entity of no particular type the bare name labels only', () => {
      expect(
        nameLabelsFor('OTHER', ['person', 'organization', 'name']),
      ).toEqual(['name']);
    });

    it('includes a declared label before anything is scanned', () => {
      const config = {
        nameLabels: { beneficiary: 'PERSON' as const },
        identifierLabels: [],
      };
      expect(nameLabelsFor('PERSON', [], config)).toEqual(['beneficiary']);
    });
  });

  describe('foldKey', () => {
    it('folds punctuation, case and diacritics away', () => {
      expect(foldKey('acme holding g.m.b.h.')).toBe('acmeholdinggmbh');
      expect(foldKey('ACME Holding GmbH'.toLowerCase())).toBe(
        'acmeholdinggmbh',
      );
      expect(foldKey('société générale')).toBe('societegenerale');
      expect(foldKey('straße 12')).toBe('strasse12');
    });

    it('is no key at all for a short value', () => {
      expect(foldKey('a.g.')).toBeNull();
    });
  });
});
