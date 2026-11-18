import { isDatabaseAlreadyExists } from './database-mode';

describe('isDatabaseAlreadyExists', () => {
  it.each([
    ['already exists', '42P04', true],
    ['a concurrent CREATE DATABASE lost the race', '23505', true],
    ['another error', '42501', false],
  ])('%s (%s)', (_label, code, expected) => {
    expect(isDatabaseAlreadyExists({ code })).toBe(expected);
  });

  it('is false for errors without a code', () => {
    expect(isDatabaseAlreadyExists(new Error('boom'))).toBe(false);
    expect(isDatabaseAlreadyExists(null)).toBe(false);
  });
});
