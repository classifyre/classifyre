import { namespaceRewriteUrl } from './namespace-request.hook';

describe('namespaceRewriteUrl', () => {
  it('preserves the Socket.IO transport path', () => {
    const request = { url: '/socket.io/?EIO=4&transport=websocket' } as any;
    expect(namespaceRewriteUrl(request)).toBe(request.url);
    expect(request.classifyreSlug).toBeUndefined();
  });

  it.each(['/api', '/api-json', '/api-yaml'])(
    'preserves the Swagger route %s',
    (url) => {
      const request = { url } as any;
      expect(namespaceRewriteUrl(request)).toBe(url);
      expect(request.classifyreSlug).toBeUndefined();
    },
  );

  it('extracts a namespace and preserves the query string', () => {
    const request = { url: '/acme/sources?limit=10' } as any;
    expect(namespaceRewriteUrl(request)).toBe('/sources?limit=10');
    expect(request.classifyreSlug).toBe('acme');
  });
});
