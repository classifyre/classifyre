import { BoundedOutput } from './bounded-output';

describe('BoundedOutput', () => {
  describe('tail mode', () => {
    it('keeps the end of the stream, which is what a failure quotes', () => {
      const out = new BoundedOutput({ mode: 'tail', maxLines: 3 });
      for (let i = 1; i <= 10; i++) out.append(`line ${i}\n`);

      const text = out.toString();
      expect(text).toContain('line 10');
      expect(text).toContain('line 8');
      expect(text).not.toContain('line 1\n');
      expect(out.truncated).toBe(true);
      expect(text).toContain('earlier line(s) omitted');
    });

    it('reassembles lines split across chunk boundaries', () => {
      const out = new BoundedOutput({ mode: 'tail' });
      out.append('INFO: scan');
      out.append('ning asset\n');
      out.finish();

      expect(out.toString()).toBe('INFO: scanning asset');
    });

    it('keeps an unterminated final line — often the error itself', () => {
      const out = new BoundedOutput({ mode: 'tail' });
      out.append('Traceback...\nMemoryError: out of memory');
      out.finish();

      expect(out.toString()).toContain('MemoryError: out of memory');
    });
  });

  describe('head mode', () => {
    it('keeps the start of the stream, where the CLI prints its JSON result', () => {
      const out = new BoundedOutput({ mode: 'head', maxLines: 3 });
      for (let i = 1; i <= 10; i++) out.append(`line ${i}\n`);

      const text = out.toString();
      expect(text).toContain('line 1');
      expect(text).not.toContain('line 10');
      expect(out.truncated).toBe(true);
    });
  });

  describe('bounded retention', () => {
    // The property that matters, stated so it cannot regress: what is retained
    // is a function of the caps and of nothing else. A scan of ten assets and a
    // scan of a million must cost the same. `stdout += chunk` failed this.
    it('retains the same amount for 1 MB and 100 MB of output', () => {
      const measure = (chunks: number) => {
        const out = new BoundedOutput({ mode: 'tail' });
        for (let i = 0; i < chunks; i++) {
          out.append(`INFO: finding ${i} ${'x'.repeat(1000)}\n`);
        }
        out.finish();
        return out.toString().length;
      };

      const small = measure(1_000); // ~1 MB in
      const large = measure(100_000); // ~100 MB in

      // Not byte-identical: line contents differ (the counter grows digits), so
      // eviction lands in a slightly different place. What must hold is that a
      // hundredfold more input does not buy measurably more retention.
      expect(Math.abs(large - small)).toBeLessThan(4096);
      expect(large).toBeLessThan(300 * 1024);
    });

    it('bounds a single pathological line instead of allocating it whole', () => {
      const out = new BoundedOutput({ mode: 'tail', maxLineLength: 1000 });
      out.append(`${'y'.repeat(5_000_000)}\n`);
      out.finish();

      expect(out.toString().length).toBeLessThan(2000);
      expect(out.toString()).toContain('line truncated');
    });

    it('bounds a writer that never emits a newline at all', () => {
      // Without the partial-line guard this is the same unbounded growth in a
      // different variable.
      const out = new BoundedOutput({ mode: 'tail', maxLineLength: 1000 });
      for (let i = 0; i < 5000; i++) out.append('z'.repeat(1000));
      out.finish();

      expect(out.toString().length).toBeLessThan(300 * 1024);
    });

    it('respects the byte cap independently of the line cap', () => {
      const out = new BoundedOutput({
        mode: 'tail',
        maxBytes: 4096,
        maxLines: 100_000,
      });
      for (let i = 0; i < 1000; i++) out.append(`${'a'.repeat(500)}\n`);
      out.finish();

      // Cap plus the truncation notice, not 500 KB.
      expect(out.toString().length).toBeLessThan(4096 + 200);
    });
  });

  it('reports no truncation when everything fits', () => {
    const out = new BoundedOutput({ mode: 'tail' });
    out.append('all good\n');
    out.finish();

    expect(out.truncated).toBe(false);
    expect(out.toString()).toBe('all good');
  });
});
