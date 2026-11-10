import {
  authorizeWorkspaceRequest,
  databaseLaneForRequest,
  namespaceRewriteUrl,
} from './namespace-request.hook';

describe('namespaceRewriteUrl', () => {
  it('preserves the Socket.IO transport path', () => {
    const request = { url: '/socket.io/?EIO=4&transport=websocket' } as any;
    expect(namespaceRewriteUrl(request)).toBe(request.url);
    expect(request.classifyreSlug).toBeUndefined();
  });

  // Swagger is mounted at `/docs`, not `/api`: the ingress strips the `/api`
  // prefix before a request reaches this process, so `<host>/api/docs` arrives
  // here as `/docs`. See `SwaggerModule.setup` in `main.ts`.
  it.each(['/docs', '/docs-json', '/docs-yaml', '/docs/swagger-ui.css'])(
    'preserves the Swagger route %s',
    (url) => {
      const request = { url } as any;
      expect(namespaceRewriteUrl(request)).toBe(url);
      expect(request.classifyreSlug).toBeUndefined();
    },
  );

  it('preserves the /api prefix the ingress reserves', () => {
    const request = { url: '/api/health/pressure' } as any;
    expect(namespaceRewriteUrl(request)).toBe(request.url);
    expect(request.classifyreSlug).toBeUndefined();
  });

  it('extracts a namespace and preserves the query string', () => {
    const request = { url: '/acme/sources?limit=10' } as any;
    expect(namespaceRewriteUrl(request)).toBe('/sources?limit=10');
    expect(request.classifyreSlug).toBe('acme');
  });
});

describe('authorizeWorkspaceRequest visitor shape (H7)', () => {
  const visitor = {
    visitor: true as const,
    tenant: { id: 't-first' },
    actor: { kind: 'visitor', ref: undefined, id: null },
    groupIds: new Set<string>(),
    grants: [],
  };
  const member = {
    tenant: { id: 't-first' },
    actor: { kind: 'person', ref: 'user:u1', id: 'user:u1' },
    groupIds: new Set<string>(['g1']),
    grants: [],
    via: 'bearer' as const,
  };
  const ns = { namespaceId: 'ws-1', slug: 'ws-1', schemaName: 'ns_ws_1' };

  async function authorize(
    principal: unknown,
    capabilities: Set<string> | null,
  ) {
    const identity = {
      authenticate: jest.fn(() => Promise.resolve(principal)),
      capabilitiesIn: jest.fn(() => Promise.resolve(capabilities)),
      groupLineage: jest.fn(() => Promise.resolve([])),
      config: { appOrigin: 'https://app.example' },
    };
    const cls = { set: jest.fn() };
    const sent: { code: number; body: unknown }[] = [];
    const reply = {
      code: (code: number) => ({
        send: (body: unknown) => {
          sent.push({ code, body });
        },
      }),
    };
    const request = { raw: {}, url: '/sources', method: 'GET', headers: {} };
    const internalApiKey = { isInternalRequest: () => false };
    const ok = await authorizeWorkspaceRequest(
      identity as any,
      cls as any,
      request as any,
      reply,
      ns,
      internalApiKey as any,
    );
    return { ok, sent };
  }

  it('answers 404 to a visitor probing another tenant', async () => {
    const { ok, sent } = await authorize(visitor, null);
    expect(ok).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0].code).toBe(404);
  });

  it('asks a visitor to sign in for their own tenant’s private workspace', async () => {
    const { ok, sent } = await authorize(visitor, new Set());
    expect(ok).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0].code).toBe(401);
  });

  it('answers 404 to a signed-in member without access', async () => {
    const { ok, sent } = await authorize(member, new Set());
    expect(ok).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0].code).toBe(404);
  });

  it('lets a visitor into a public workspace', async () => {
    const { ok, sent } = await authorize(visitor, new Set(['workspace.view']));
    expect(ok).toBe(true);
    expect(sent).toHaveLength(0);
  });
});

describe('databaseLaneForRequest', () => {
  it('keeps browser traffic on the interactive lane', () => {
    const internalApiKey = { isInternalRequest: jest.fn(() => false) };

    expect(databaseLaneForRequest({}, internalApiKey)).toBe('interactive');
  });

  it('routes authenticated CLI callbacks to the background lane', () => {
    const headers = { 'x-classifyre-internal-key': 'secret' };
    const internalApiKey = {
      isInternalRequest: jest.fn((candidate) => candidate === headers),
    };

    expect(databaseLaneForRequest(headers, internalApiKey)).toBe('background');
  });
});
