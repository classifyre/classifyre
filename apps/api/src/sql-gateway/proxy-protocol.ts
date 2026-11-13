/**
 * The PROXY protocol (v1 text, v2 binary,
 * https://www.haproxy.org/download/2.9/doc/proxy-protocol.txt): a TCP proxy
 * in front of the SQL gateway (Traefik, HAProxy, a cloud load balancer) says
 * who the client really is, so lockouts and allowed networks see the client,
 * not the proxy. Only read when `SQL_GATEWAY_PROXY_PROTOCOL` is on: then every
 * connection must start with it.
 */
export interface PeekReader {
  peek(bytes: number): Promise<Buffer>;
  take(bytes: number): Buffer;
}

const V2_SIGNATURE = Buffer.from([
  0x0d, 0x0a, 0x0d, 0x0a, 0x00, 0x0d, 0x0a, 0x51, 0x55, 0x49, 0x54, 0x0a,
]);

/** The client address the proxy reports; null for LOCAL (the proxy's own health check). */
export async function readProxyHeader(
  reader: PeekReader,
): Promise<string | null> {
  const start = await reader.peek(5);
  if (start.toString('latin1') === 'PROXY') {
    let length = 16;
    for (;;) {
      const head = await reader.peek(Math.min(length, 107));
      const end = head.indexOf('\r\n');
      if (end >= 0) {
        const line = reader
          .take(end + 2)
          .toString('latin1')
          .trim();
        const parts = line.split(' ');
        return parts[1] === 'UNKNOWN' ? null : (parts[2] ?? null);
      }
      if (length >= 107) throw new Error('PROXY v1 header too long.');
      length = Math.min(length * 2, 107);
    }
  }
  const head = await reader.peek(16);
  if (!head.subarray(0, 12).equals(V2_SIGNATURE)) {
    throw new Error('Expected a PROXY protocol header.');
  }
  const command = head[12] & 0x0f;
  const family = head[13] >> 4;
  const length = head.readUInt16BE(14);
  const whole = await reader.peek(16 + length);
  reader.take(16 + length);
  if (command === 0) return null;
  const body = whole.subarray(16);
  if (family === 1 && body.length >= 12) {
    return [...body.subarray(0, 4)].join('.');
  }
  if (family === 2 && body.length >= 36) {
    const groups: string[] = [];
    for (let i = 0; i < 16; i += 2)
      groups.push(body.readUInt16BE(i).toString(16));
    return groups.join(':');
  }
  return null;
}
