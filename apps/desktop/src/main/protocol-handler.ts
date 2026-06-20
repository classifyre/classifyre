import { protocol, net } from 'electron';
import path from 'path';
import fs from 'fs';

export function registerAppProtocol(staticDir: string): void {
  const resolvedRoot = path.resolve(staticDir);

  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let filePath = path.resolve(resolvedRoot, decodeURIComponent(url.pathname).replace(/^\/+/, ''));

    if (!filePath.startsWith(resolvedRoot)) {
      filePath = path.join(resolvedRoot, 'index.html');
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      const candidates = [
        path.join(filePath, 'index.html'),
        filePath + '.html',
        path.join(resolvedRoot, 'index.html'),
      ].filter((c) => c.startsWith(resolvedRoot));

      const found = candidates.find((c) => fs.existsSync(c));
      filePath = found ?? path.join(resolvedRoot, 'index.html');
    }

    return net.fetch(`file://${filePath}`);
  });
}
