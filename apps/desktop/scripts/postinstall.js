#!/usr/bin/env node

// Workaround: bun doesn't preserve dylib symlinks from npm packages.
// embedded-postgres ships versioned dylibs (e.g. libzstd.1.5.7.dylib) but
// PostgreSQL binaries reference short names (e.g. libzstd.1.dylib).
// This script creates all missing short-name symlinks.

const fs = require('fs');
const path = require('path');
const os = require('os');

const platform = os.platform();
if (platform !== 'darwin' && platform !== 'linux') process.exit(0);

const arch = os.arch();
const platformPkg =
  platform === 'darwin'
    ? `darwin-${arch === 'arm64' ? 'arm64' : 'x64'}`
    : `linux-${arch === 'arm64' ? 'arm64' : 'x64'}`;

const candidates = [];

// Standard node_modules layout
candidates.push(
  path.resolve(__dirname, `../../../node_modules/@embedded-postgres/${platformPkg}/native/lib`),
  path.resolve(__dirname, `../../node_modules/@embedded-postgres/${platformPkg}/native/lib`),
);

// Bun hoisted layout
const bunHoisted = path.resolve(__dirname, '../../../node_modules/.bun');
if (fs.existsSync(bunHoisted)) {
  for (const entry of fs.readdirSync(bunHoisted)) {
    if (entry.startsWith(`@embedded-postgres+${platformPkg}`)) {
      candidates.push(
        path.join(bunHoisted, entry, 'node_modules/@embedded-postgres', platformPkg, 'native/lib'),
      );
    }
  }
}

const ext = platform === 'darwin' ? '.dylib' : '.so';

for (const libDir of candidates) {
  if (!fs.existsSync(libDir)) continue;

  for (const file of fs.readdirSync(libDir)) {
    if (!file.endsWith(ext)) continue;

    // Progressively strip trailing version segments before the extension.
    // e.g. libzstd.1.5.7.dylib -> libzstd.1.5.dylib -> libzstd.1.dylib -> libzstd.dylib
    let current = file;
    const versionedPattern = new RegExp(`\\.\\d+\\${ext}$`);

    while (versionedPattern.test(current)) {
      const shorter = current.replace(new RegExp(`\\.\\d+\\${ext}$`), ext);
      const shorterPath = path.join(libDir, shorter);

      if (!fs.existsSync(shorterPath)) {
        fs.symlinkSync(file, shorterPath);
        console.log(`[postinstall] ${shorter} -> ${file}`);
      }

      current = shorter;
    }
  }

  console.log(`[postinstall] Symlinks verified in ${libDir}`);
}
