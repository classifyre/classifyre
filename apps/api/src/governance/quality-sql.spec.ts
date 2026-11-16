import {
  compileQuality,
  redactQueryError,
  scalarQueryProblem,
} from './quality-sql';

describe('scalarQueryProblem', () => {
  it('accepts a balanced query with parentheses inside strings', () => {
    expect(
      scalarQueryProblem(
        "SELECT COUNT(*) FROM {object} WHERE note <> ')' AND name = 'O''Brien'",
      ),
    ).toBeNull();
  });

  it('refuses a query that closes the parenthesis it is measured in', () => {
    expect(
      scalarQueryProblem(
        'SELECT 1) AS q_0, email FROM {object} GROUP BY email LIMIT 10 --',
      ),
    ).toMatch(/parenthesis|Comments/);
    expect(
      scalarQueryProblem('SELECT 1) AS q_0, email FROM t GROUP BY (email'),
    ).toMatch(/never opened/);
  });

  it('refuses comments, escaped and dollar-quoted strings', () => {
    expect(scalarQueryProblem('SELECT 1 /* ) */')).toMatch(/Comments/);
    expect(scalarQueryProblem("SELECT E'\\'' ")).toMatch(/Escaped/);
    expect(scalarQueryProblem('SELECT $$)$$')).toMatch(/Dollar/);
    expect(scalarQueryProblem("SELECT 'open")).toMatch(/unclosed/);
    expect(scalarQueryProblem('SELECT 1; SELECT 2')).toMatch(/one statement/);
  });

  it('keeps a word ending in e before a quote apart from E-strings', () => {
    expect(
      scalarQueryProblem("SELECT COUNT(*) FROM t WHERE name ILIKE'a%'"),
    ).toBeNull();
  });

  it('turns a breaking sql rule into an error, not SQL', () => {
    const compiled = compileQuality(
      's.p.t',
      ['email'],
      [
        {
          id: 'r',
          type: 'sql',
          metric: 'custom',
          columnName: null,
          arguments: { query: 'SELECT 1) AS q_0, email FROM {object} --' },
        },
      ],
    );
    expect(compiled.errors.get('r')).toBeDefined();
    expect(compiled.sql).not.toContain('email');
  });
});

describe('redactQueryError', () => {
  it('cuts the value an engine error quotes', () => {
    expect(
      redactQueryError(
        "Conversion Error: Could not convert string 'jane@example.test' to INT32",
      ),
    ).toBe("Conversion Error: Could not convert string '…' to INT32");
  });

  it('keeps short quoted identifiers', () => {
    expect(redactQueryError('Binder Error: column "email" not found')).toBe(
      'Binder Error: column "email" not found',
    );
  });
});
