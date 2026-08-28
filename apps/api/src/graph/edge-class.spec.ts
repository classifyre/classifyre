import {
  resolveEdgeClass,
  isEdgeClass,
  isDerivationEvidence,
  LINEAGE_CLASS,
  DERIVATION_CLASSES,
} from './edge-class';

/**
 * This table has to stay identical to the backfill in
 * `20260824120000_add_edge_classes_and_urn`. If they drift, an edge written by
 * an older connector is classed one way and the same edge already in the
 * database is classed another — so the lineage view shows different answers
 * depending on when the row happened to be written.
 */
describe('resolveEdgeClass', () => {
  it('honours a class the connector declared', () => {
    expect(resolveEdgeClass('FLOW', 'anything')).toBe('FLOW');
  });

  it('ignores a declared class that is not one of the five', () => {
    expect(resolveEdgeClass('LINEAGE', 'CONTAINS')).toBe('CONTAINMENT');
  });

  it('classes structural relations as containment', () => {
    // Containment is what a lineage graph collapses *by*. Filed as FLOW it
    // would put every archive member on the path between two systems.
    expect(resolveEdgeClass(null, 'CONTAINS')).toBe('CONTAINMENT');
    expect(resolveEdgeClass(null, 'ATTACHED_TO')).toBe('CONTAINMENT');
  });

  it('classes data movement as flow', () => {
    for (const type of [
      'TRANSFORM',
      'VIEW',
      'COPY',
      'WRITES',
      'EXPORTED_TO',
      'SENT_TO',
    ]) {
      expect(resolveEdgeClass(null, type)).toBe(LINEAGE_CLASS);
    }
  });

  it('classes READS as usage, not flow', () => {
    // It points from the reader to the thing read, which is the opposite of the
    // way the data moved — and this product already answers "who touched this?"
    // with incoming ACCESSED/READS/EXECUTED.
    expect(resolveEdgeClass(null, 'READS')).toBe('USAGE');
    expect(resolveEdgeClass(null, 'ACCESSED')).toBe('USAGE');
    expect(resolveEdgeClass(null, 'OWNS')).toBe('USAGE');
  });

  it('keeps a foreign key out of lineage', () => {
    // No data moves through a foreign key. Useful for join suggestions and for
    // guessing lineage; never lineage itself.
    expect(resolveEdgeClass(null, 'FOREIGN_KEY')).toBe('REFERENCE');
  });

  it('treats byte-identical content as the same thing twice', () => {
    expect(resolveEdgeClass(null, 'identical_content')).toBe('IDENTITY');
    expect(resolveEdgeClass(null, 'SAME_AS')).toBe('IDENTITY');
  });

  it('leaves correlation and link edges as references', () => {
    for (const type of [
      'links_to',
      'related',
      'likely_duplicate',
      'MENTIONS',
    ]) {
      expect(resolveEdgeClass(null, type)).toBe('REFERENCE');
    }
  });

  it('falls back to the class that propagates nothing', () => {
    // An edge whose meaning nobody declared must not silently become a lineage
    // hop — a wrong REFERENCE is inert, a wrong FLOW is an incorrect answer.
    expect(resolveEdgeClass(null, 'SOMETHING_NEW')).toBe('REFERENCE');
  });

  it('does not offer GENERATED_FROM any more', () => {
    // It pointed downstream -> upstream while every other flow type points the
    // way the data moves. The migration flipped the rows it had into TRANSFORM;
    // classing it here would reintroduce the inconsistency.
    expect(resolveEdgeClass(null, 'GENERATED_FROM')).toBe('REFERENCE');
  });

  it('recognises exactly the five classes', () => {
    expect(isEdgeClass('FLOW')).toBe(true);
    expect(isEdgeClass('LINEAGE')).toBe(false);
    expect(isEdgeClass(undefined)).toBe(false);
  });

  // ── Derivation evidence for the fingerprints 2x2 ─────────────────────────
  //
  // These guard the one way this feature can fail while looking healthy: if
  // the correlation engine's own edges counted as evidence about the
  // correlation engine's output, every duplicate pair would report a
  // derivation path and nothing would ever be escalated.

  it('never treats a correlation edge as derivation evidence', () => {
    for (const type of ['related', 'likely_duplicate']) {
      // Their class is REFERENCE, so they fail on the class test...
      expect(resolveEdgeClass(null, type)).toBe('REFERENCE');
      expect(isDerivationEvidence(null, type)).toBe(false);
      // ...and they must still fail when a caller declares a class that would
      // otherwise pass. A declared class does not launder the relation type.
      expect(isDerivationEvidence('FLOW', type)).toBe(false);
      expect(isDerivationEvidence('IDENTITY', type)).toBe(false);
    }
  });

  it('excludes identical_content despite it being IDENTITY', () => {
    // CorrelationService.linkIdenticalContent produces it, so using it as
    // independent evidence about that same service's output is circular.
    expect(resolveEdgeClass(null, 'identical_content')).toBe('IDENTITY');
    expect(isDerivationEvidence(null, 'identical_content')).toBe(false);
  });

  it('keeps connector-declared SAME_AS, which is a different source', () => {
    expect(isDerivationEvidence(null, 'SAME_AS')).toBe(true);
  });

  it('accepts flow and containment as derivation evidence', () => {
    expect(isDerivationEvidence(null, 'TRANSFORM')).toBe(true);
    expect(isDerivationEvidence(null, 'EXPORTED_TO')).toBe(true);
    expect(isDerivationEvidence(null, 'CONTAINS')).toBe(true);
  });

  it('rejects usage and plain references', () => {
    // "who read this" and "this links to that" say nothing about derivation.
    expect(isDerivationEvidence(null, 'READS')).toBe(false);
    expect(isDerivationEvidence(null, 'links_to')).toBe(false);
    expect(isDerivationEvidence(null, 'MENTIONS')).toBe(false);
  });

  it('is a different question from lineage', () => {
    // The lineage view walks FLOW; the 2x2 also accepts structure and identity.
    // If these ever collapse into one set, one of the two is wrong.
    expect(DERIVATION_CLASSES).toContain(LINEAGE_CLASS);
    expect(DERIVATION_CLASSES.length).toBeGreaterThan(1);
  });
});
