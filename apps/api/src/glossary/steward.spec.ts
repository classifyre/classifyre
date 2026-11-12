import { BadRequestException } from '@nestjs/common';
import { stewardFromImport, stewardRefOrThrow } from './steward';

describe('glossary steward (GOV R11)', () => {
  it('takes a person or a group, and nothing for blank', () => {
    expect(stewardRefOrThrow('user:5c1f')).toBe('user:5c1f');
    expect(stewardRefOrThrow(' group:finance ')).toBe('group:finance');
    expect(stewardRefOrThrow('')).toBeNull();
    expect(stewardRefOrThrow(null)).toBeNull();
    expect(stewardRefOrThrow(undefined)).toBeUndefined();
  });

  it('refuses a plain name from people and agents', () => {
    expect(() => stewardRefOrThrow('Data Office')).toThrow(BadRequestException);
    expect(() => stewardRefOrThrow('mcp:token')).toThrow(BadRequestException);
  });

  it('moves imported text to the notes, once', () => {
    expect(stewardFromImport('Data Office', 'Kept.')).toEqual({
      steward: null,
      notes: 'Kept.\n\nSteward (as imported): Data Office',
    });
    expect(
      stewardFromImport('Data Office', 'Steward (as imported): Data Office')
        .notes,
    ).toBe('Steward (as imported): Data Office');
    expect(stewardFromImport('group:finance', null)).toEqual({
      steward: 'group:finance',
      notes: null,
    });
  });
});
