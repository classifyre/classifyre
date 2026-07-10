// Re-sign a packaged macOS .app when its nested code signatures fail
// verification. Called from the release workflow's post-package verify gate:
//
//   node scripts/resign-macos.mjs <path-to-Classifyre.app>
//
// Why this exists: Apple's notary rejects builds with "The signature of the
// binary is invalid" on the Electron helper apps (GPU/Renderer/Plugin) when a
// codesign spawn is dropped during packaging's deep-sign (FD exhaustion on the
// ~1000-Mach-O bundle), leaving a helper with a truncated signature. Rather
// than waste a ~45-minute notary round-trip discovering that, the workflow
// verifies locally right after packaging and, on failure, re-signs here.
//
// This re-invokes @electron/osx-sign's own sign() — the SAME engine
// @electron/packager uses during `forge package` — so it reuses the correct
// per-helper default entitlements and signs strictly inside-out (children
// deepest-first, top-level app last). Unlike the packaging path it signs
// sequentially, so the re-sign cannot re-trigger the FD-exhaustion that caused
// the invalid signature in the first place.
//
// The optionsForFile mapping MUST stay in sync with apps/desktop/forge.config.ts
// (the Python resources need disable-library-validation via
// build/entitlements.python.plist so runtime-installed native extensions load;
// everything else keeps osx-sign's stricter per-file defaults).

import path from 'path';
import { fileURLToPath } from 'url';
import { sign } from '@electron/osx-sign';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const appPath = process.argv[2];
if (!appPath) {
  console.error('Usage: node scripts/resign-macos.mjs <path-to-app>');
  process.exit(1);
}

// Keep in sync with forge.config.ts.
const pythonEntitlements = path.resolve(__dirname, '..', 'build/entitlements.python.plist');
const isPythonResource = (filePath) =>
  filePath.includes('/Contents/Resources/python/') ||
  filePath.includes('/Contents/Resources/venv/');

// Pin the identity when provided (APPLE_SIGNING_IDENTITY); otherwise let
// osx-sign auto-discover the "Developer ID Application" identity from the
// keychain, exactly as the packaging step does.
const signingIdentity = process.env['APPLE_SIGNING_IDENTITY'];

await sign({
  app: appPath,
  platform: 'darwin',
  ...(signingIdentity ? { identity: signingIdentity } : {}),
  optionsForFile: (filePath) =>
    isPythonResource(filePath) ? { entitlements: pythonEntitlements } : {},
});

console.log(`Re-signed ${appPath}`);
