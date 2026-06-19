import { protocol, net } from 'electron';
import path from 'path';
import fs from 'fs';

export function registerAppProtocol(staticDir: string): void {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let filePath = path.join(staticDir, decodeURIComponent(url.pathname));

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      const candidates = [
        path.join(filePath, 'index.html'),
        filePath + '.html',
        path.join(staticDir, 'index.html'),
      ];

      const found = candidates.find((c) => fs.existsSync(c));
      filePath = found ?? path.join(staticDir, 'index.html');
    }

    return net.fetch(`file://${filePath}`);
  });
}
