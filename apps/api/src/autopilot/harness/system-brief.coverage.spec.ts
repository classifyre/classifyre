import { renderCoverage } from './system-brief.service';

/**
 * The corpus-coverage paragraph injected into every mission's system prompt.
 *
 * `computeFacts` derived every count from sources that HAVE assets, so a source
 * that had never been scanned was invisible to it. On the first real run the
 * brief reported "Sources: 151" while 121 of them had never been scanned at
 * all — and the agent, told 151 and shown findings from 12, wrote inquiries
 * about "the corpus".
 */
describe('renderCoverage', () => {
  // The exact shape of the first real run.
  const enron = {
    sources: 151,
    sourcesScanned: 12,
    sourcesNeverScanned: 121,
    sourcesInFlight: 3,
    sourcesFailing: 14,
    findingsAnalyzed: 2104,
    findingsOpen: 105701,
  };

  it('states the ratio the agent was previously left to infer', () => {
    const out = renderCoverage(enron);

    expect(out).toContain('12 of 151 reachable sources scanned (8%)');
    expect(out).toContain('121 never scanned');
    expect(out).toContain('14 failing');
  });

  it('reports the evidence-analysis backlog as pending, not as unimportant', () => {
    const out = renderCoverage(enron);

    expect(out).toContain('2104 of 105701 open findings scored');
    expect(out).toMatch(/pending, not unimportant/);
  });

  it('says the limit out loud when coverage is partial', () => {
    const out = renderCoverage(enron);

    expect(out).toContain('YOU ARE SEEING 8% OF THIS CORPUS');
  });

  it('names the specific claims that are unsupported at low coverage', () => {
    const out = renderCoverage(enron);

    // Absence claims and cross-source generalisations are the two failure
    // modes the first run actually exhibited.
    expect(out).toMatch(/absence of something/);
    expect(out).toMatch(/across sources/);
    expect(out).toMatch(/memory\.write, not an inquiry/);
  });

  it('drops the warning once the corpus is essentially covered', () => {
    const out = renderCoverage({
      ...enron,
      sourcesScanned: 151,
      sourcesNeverScanned: 0,
    });

    expect(out).not.toContain('YOU ARE SEEING');
    expect(out).toContain('151 of 151 reachable sources scanned (100%)');
  });

  it('does not shout at a fresh instance with no sources', () => {
    const out = renderCoverage({
      sources: 0,
      sourcesScanned: 0,
      sourcesNeverScanned: 0,
      sourcesInFlight: 0,
      sourcesFailing: 0,
      findingsAnalyzed: 0,
      findingsOpen: 0,
    });

    expect(out).not.toContain('YOU ARE SEEING');
  });

  it('still warns when a single source of many has been scanned', () => {
    const out = renderCoverage({ ...enron, sources: 2, sourcesScanned: 1 });

    expect(out).toContain('YOU ARE SEEING 50% OF THIS CORPUS');
  });

  // The ratchet: coverage used to divide by every source row, so sources that
  // can never be scanned held the ratio below the threshold for good. Below it
  // the brief tells the agent it is looking at a sample and the coverage
  // doctrine tells it to defer instead of act — which is how a handful of dead
  // sources put the whole harness into permanent observe-and-defer mode.
  describe('sources that cannot be scanned', () => {
    it('excludes them from the ratio instead of holding it down forever', () => {
      const out = renderCoverage({
        ...enron,
        sources: 151,
        sourcesScanned: 130,
        sourcesReachable: 131,
        sourcesUnavailable: 20,
        sourcesNeverScanned: 21,
      });

      // 130/131, not 130/151 (86%, which would have kept the warning on).
      expect(out).toContain('130 of 131 reachable sources scanned (99%)');
      expect(out).not.toContain('YOU ARE SEEING');
    });

    it('names them, so the gap is visible rather than quietly dropped', () => {
      const out = renderCoverage({
        ...enron,
        sourcesReachable: 131,
        sourcesUnavailable: 20,
      });

      expect(out).toContain('20 of 151 sources cannot be scanned at all');
      expect(out).toMatch(/configuration problem, not missing evidence/);
    });

    it('says nothing about them when there are none', () => {
      const out = renderCoverage(enron);

      expect(out).not.toContain('cannot be scanned at all');
    });

    it('reports 0%, not 100%, when nothing readable has been read', () => {
      const out = renderCoverage({
        ...enron,
        sources: 10,
        sourcesScanned: 0,
        sourcesReachable: 0,
        sourcesUnavailable: 10,
      });

      expect(out).toContain('YOU ARE SEEING 0% OF THIS CORPUS');
    });
  });

  it('renders missing facts without producing NaN', () => {
    const out = renderCoverage({});

    expect(out).not.toContain('NaN');
  });
});
