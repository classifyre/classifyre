import { createServer } from 'net';

export async function getAvailablePort(preferred?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(preferred ?? 0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close(() => reject(new Error('Failed to get port')));
        return;
      }
      const port = addr.port;
      server.close(() => resolve(port));
    });
    server.on('error', () => {
      if (preferred) {
        const fallback = createServer();
        fallback.listen(0, '127.0.0.1', () => {
          const addr = fallback.address();
          if (!addr || typeof addr === 'string') {
            fallback.close(() => reject(new Error('Failed to get port')));
            return;
          }
          fallback.close(() => resolve(addr.port));
        });
        fallback.on('error', reject);
      } else {
        reject(new Error('Failed to bind to any port'));
      }
    });
  });
}
