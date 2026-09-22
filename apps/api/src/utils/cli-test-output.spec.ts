import { parseCliTestOutput } from './cli-test-output';

describe('parseCliTestOutput', () => {
  it('reads an indented multi-line result among log lines (field report P3)', () => {
    const output = [
      'INFO:__main__:Validating recipe for custom...',
      '{',
      '  "timestamp": "2026-09-17T12:55:41.829851+00:00",',
      '  "source_type": "CUSTOM",',
      '  "status": "SUCCESS",',
      '  "message": "GENESIS reachable: Sie wurden erfolgreich an- und abgemeldet!"',
      '}',
      'INFO:__main__:done',
    ].join('\n');

    const { result, otherLines } = parseCliTestOutput(output);

    expect(result).toMatchObject({
      status: 'SUCCESS',
      message: 'GENESIS reachable: Sie wurden erfolgreich an- und abgemeldet!',
    });
    expect(otherLines).toEqual([
      'INFO:__main__:Validating recipe for custom...',
      'INFO:__main__:done',
    ]);
  });

  it("keeps a failing connector's own error, with nested objects", () => {
    const output = [
      'WARNING:src.sources.custom:notebook raised',
      '{',
      '  "status": "FAILURE",',
      '  "message": "GENESIS status 6: Anmeldung fehlgeschlagen",',
      '  "details": {',
      '    "code": 6',
      '  }',
      '}',
    ].join('\n');

    const { result, otherLines } = parseCliTestOutput(output);

    expect(result).toMatchObject({
      status: 'FAILURE',
      message: 'GENESIS status 6: Anmeldung fehlgeschlagen',
      details: { code: 6 },
    });
    expect(otherLines).toEqual(['WARNING:src.sources.custom:notebook raised']);
  });

  it('still reads a compact single-line result', () => {
    const { result } = parseCliTestOutput(
      'log line\n{"status": "SUCCESS", "message": "ok"}\n',
    );
    expect(result).toEqual({ status: 'SUCCESS', message: 'ok' });
  });

  it('prefers the object that carries a status over structured log objects', () => {
    const output = [
      '{"event": "progress", "step": 1}',
      '{"status": "SUCCESS", "message": "ok"}',
      '{"event": "progress", "step": 2}',
    ].join('\n');
    expect(parseCliTestOutput(output).result).toEqual({
      status: 'SUCCESS',
      message: 'ok',
    });
  });

  it('returns no result and every line when nothing parses', () => {
    const { result, otherLines } = parseCliTestOutput(
      'Traceback (most recent call last):\n  File "x"\n{ broken',
    );
    expect(result).toBeNull();
    expect(otherLines).toEqual([
      'Traceback (most recent call last):',
      'File "x"',
      '{ broken',
    ]);
  });
});
