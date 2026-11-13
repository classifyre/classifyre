import { parseActorRef, personOf, sqlConnectionRef } from './actor-ref';
import {
  asAuditChannel,
  channelOfRef,
  viaOfChannel,
} from './audit-trail.service';

/** Mirrored in apps/web/lib/actor-ref.spec.ts: the two grammars must agree. */
describe('actor references', () => {
  it.each([
    ['user:9f2c', 'user'],
    ['user:9f2c@mcp:41ab-77', 'user'],
    ['user:9f2c@sql:559880b7-e99c-4d83-bf89-857149aeec9f', 'user'],
    ['group:g-1', 'group'],
    ['mcp:41ab', 'mcp'],
    ['agent:autopilot', 'agent'],
    ['system:quality', 'system'],
    ['Jordan Reyes', 'name'],
    ['user:9f2c@other:1', 'name'],
  ])('%s is a %s', (ref, kind) => {
    expect(parseActorRef(ref).kind).toBe(kind);
  });

  it('names the channel a delegated action came through', () => {
    expect(parseActorRef('user:a@sql:c-1').via).toEqual({
      kind: 'sql',
      id: 'c-1',
    });
    expect(parseActorRef('user:a@mcp:t-1').via).toEqual({
      kind: 'mcp',
      id: 't-1',
    });
    expect(sqlConnectionRef('a', 'c-1')).toBe('user:a@sql:c-1');
  });

  it('finds the person behind a delegated reference', () => {
    expect(personOf('user:a@sql:c-1')).toBe('user:a');
    expect(personOf('user:a@mcp:t')).toBe('user:a');
    expect(personOf('user:a')).toBe('user:a');
    expect(personOf('system:quality')).toBe('system:quality');
    expect(personOf(undefined)).toBeNull();
  });

  it('turns references and stored values into channels', () => {
    expect(channelOfRef('user:a@sql:c')).toBe('sql');
    expect(channelOfRef('user:a@mcp:t')).toBe('mcp');
    expect(channelOfRef('user:a')).toBe('rest');
    expect(channelOfRef(null)).toBe('rest');
    expect(asAuditChannel('sql')).toBe('sql');
    expect(asAuditChannel('bogus')).toBe('rest');
    expect(viaOfChannel('sql')).toBe('sql-connection');
    expect(viaOfChannel('mcp')).toBe('mcp-token');
    expect(viaOfChannel('rest')).toBe('oidc');
  });
});
