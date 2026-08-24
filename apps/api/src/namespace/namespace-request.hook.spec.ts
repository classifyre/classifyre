import {
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
