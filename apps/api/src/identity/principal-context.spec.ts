import { applyPrincipalContext } from './principal-context';
import { CLS_ACTOR } from './actor-context.service';
import {
  CLS_CAPABILITIES,
  CLS_ORG_ID,
  CLS_PERSON,
  CLS_RESOURCE_GRANTS,
} from './iam-access-policy';
import type { Principal } from './identity.service';

describe('applyPrincipalContext', () => {
  it('sets actor, capabilities, org, person and single-resource grants', async () => {
    const store = new Map<string, unknown>();
    const cls = { set: (k: string, v: unknown) => store.set(k, v) };
    const principal = {
      sub: 's',
      actor: {
        id: 'user:s',
        ref: 'user:s@sql:c',
        via: 'sql-connection',
        kind: 'person',
        displayName: null,
      },
      orgId: 'org-1',
      groupIds: new Set(['g1']),
      grants: [
        {
          roleKey: 'data-reader',
          scopeType: 'asset',
          scopeId: 'ns-1/a1',
          groupId: 'g1',
        },
        {
          roleKey: 'data-reader',
          scopeType: 'source',
          scopeId: 'ns-2/s9',
          groupId: 'g1',
        },
      ],
    } as unknown as Principal;
    await applyPrincipalContext(
      cls as never,
      { groupLineage: () => Promise.resolve(['g1', 'parent']) },
      principal,
      new Set(['workspace.view']),
      'ns-1',
    );
    expect(store.get(CLS_ACTOR)).toBe(principal.actor);
    expect(store.get(CLS_CAPABILITIES)).toEqual(new Set(['workspace.view']));
    expect(store.get(CLS_ORG_ID)).toBe('org-1');
    expect(store.get(CLS_PERSON)).toEqual({
      actorRef: 'user:s',
      groupIds: ['g1', 'parent'],
    });
    const grants = store.get(CLS_RESOURCE_GRANTS) as Record<
      string,
      { assetIds: string[]; sourceIds: string[] }
    >;
    expect(grants['data.query'].assetIds).toEqual(['a1']);
    expect(grants['data.query'].sourceIds).toEqual([]);
    expect(grants['data.connect'].assetIds).toEqual(['a1']);
  });
});
