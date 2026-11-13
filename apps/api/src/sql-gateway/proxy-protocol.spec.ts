import { readProxyHeader, type PeekReader } from './proxy-protocol';

function reader(bytes: Buffer): PeekReader & { left: () => Buffer } {
  let buffer = bytes;
  return {
    peek: (n) => {
      if (buffer.length < n) return Promise.reject(new Error('short'));
      return Promise.resolve(buffer.subarray(0, n));
    },
    take: (n) => {
      const out = buffer.subarray(0, n);
      buffer = buffer.subarray(n);
      return out;
    },
    left: () => buffer,
  };
}

const V2 = Buffer.from([
  0x0d, 0x0a, 0x0d, 0x0a, 0x00, 0x0d, 0x0a, 0x51, 0x55, 0x49, 0x54, 0x0a,
]);

describe('PROXY protocol', () => {
  it('reads v1 without reading past it (a short SSLRequest follows)', async () => {
    const r = reader(
      Buffer.concat([
        Buffer.from('PROXY TCP4 203.0.113.7 10.0.0.1 51234 5432\r\n'),
        Buffer.from([0, 0, 0, 8, 4, 0xd2, 0x16, 0x2f]),
      ]),
    );
    expect(await readProxyHeader(r)).toBe('203.0.113.7');
    expect(r.left()).toHaveLength(8);
  });

  it('reads v1 and leaves the rest of the stream', async () => {
    const r = reader(
      Buffer.from('PROXY TCP4 203.0.113.7 10.0.0.1 51234 5432\r\nREST'),
    );
    expect(await readProxyHeader(r)).toBe('203.0.113.7');
    expect(r.left().toString()).toBe('REST');
  });

  it('reads v2 IPv4 and LOCAL', async () => {
    const ipv4 = Buffer.concat([
      V2,
      Buffer.from([0x21, 0x11, 0x00, 0x0c]),
      Buffer.from([203, 0, 113, 7, 10, 0, 0, 1, 0xc8, 0x22, 0x15, 0x38]),
      Buffer.from('X'),
    ]);
    const r = reader(ipv4);
    expect(await readProxyHeader(r)).toBe('203.0.113.7');
    expect(r.left().toString()).toBe('X');
    const local = Buffer.concat([V2, Buffer.from([0x20, 0x00, 0x00, 0x00])]);
    expect(await readProxyHeader(reader(local))).toBeNull();
  });

  it('refuses a stream without a header', async () => {
    await expect(
      readProxyHeader(
        reader(Buffer.from('\x00\x00\x00\x08\x04\xd2\x16\x2f____________')),
      ),
    ).rejects.toThrow('Expected a PROXY protocol header.');
  });
});
