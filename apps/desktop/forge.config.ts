import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 'api' is a directory on Linux/Windows but a single api.tar.gz on macOS
// (65k loose node_modules files made Apple's notary scan take hours); the
// existsSync filter below picks whichever the staging script produced.
const allResources = ['api', 'api.tar.gz', 'web', 'pg', 'venv', 'python', 'pyapp'];
const extraResource = allResources
  .map((name) => path.resolve(__dirname, 'resources', name))
  .filter((abs) => fs.existsSync(abs));

// macOS signing/notarization is opt-in via env so unsigned local/CI builds
// stay green. Set MACOS_SIGN=1 to sign with the "Developer ID Application"
// identity from the keychain (or pin one via APPLE_SIGNING_IDENTITY).
// Notarization uses an App Store Connect API key: APPLE_API_KEY (path to the
// .p8 file), APPLE_API_KEY_ID, APPLE_API_ISSUER_ID. See apps/desktop/README.md.
const signingIdentity = process.env['APPLE_SIGNING_IDENTITY'];
const signingEnabled = process.env['MACOS_SIGN'] === '1' || !!signingIdentity;

// The bundled CPython interpreter installs optional source connectors (e.g.
// psycopg2) on demand at runtime. Those wheels carry ad-hoc-signed native .so
// files, which the hardened runtime's library validation refuses to dlopen into
// our Developer ID-signed python3.12 ("different Team IDs"). Sign the Python
// binaries with disable-library-validation so runtime-installed extensions load;
// every other file keeps @electron/osx-sign's stricter per-file defaults.
const pythonEntitlements = path.resolve(__dirname, 'build/entitlements.python.plist');
const isPythonResource = (filePath: string): boolean =>
  filePath.includes('/Contents/Resources/python/') ||
  filePath.includes('/Contents/Resources/venv/');
const osxSign = signingEnabled
  ? {
      ...(signingIdentity ? { identity: signingIdentity } : {}),
      optionsForFile: (filePath: string) =>
        isPythonResource(filePath) ? { entitlements: pythonEntitlements } : {},
    }
  : undefined;
// Notarization is deliberately NOT done through Forge (no osxNotarize):
// @electron/notarize runs `notarytool submit --wait` with no timeout inside
// the packaging step, and Apple's long-poll can hang for hours on CI — and a
// retry then repeats the entire 40-minute deep-sign before reaching Apple
// again. The release workflow notarizes + staples the signed .app itself with
// explicit `xcrun notarytool --timeout`, retries, and `notarytool log`
// diagnostics (see release-desktop.yml "Notarize and staple").

const linuxOptions = {
  name: 'classifyre-desktop',
  productName: 'Classifyre',
  genericName: 'Metadata Ingestion',
  description: 'Classifyre Desktop — metadata ingestion for unstructured data sources',
  homepage: 'https://github.com/classifyre/classifyre',
  categories: ['Utility'] as ['Utility'],
  icon: path.resolve(__dirname, 'build/icon.png'),
  // rpmbuild aborts without a License tag ("License field must be present");
  // this is a private/commercial app, so declare it proprietary.
  license: 'Proprietary',
};

const config: ForgeConfig = {
  buildIdentifier: 'classifyre',
  packagerConfig: {
    name: 'Classifyre',
    executableName: 'classifyre-desktop',
    appBundleId: 'com.classifyre.desktop',
    icon: path.resolve(__dirname, 'build/icon'),
    asar: true,
    ...(osxSign ? { osxSign } : {}),
    ...(extraResource.length > 0 ? { extraResource } : {}),
  },
  makers: [
    // macOS → .dmg
    new MakerDMG({
      icon: path.resolve(__dirname, 'build/icon.icns'),
      format: 'ULFO',
    }),
    // Windows → portable zip. Squirrel was dropped deliberately: its
    // single-threaded LZMA spent ~3.5h compressing the multi-GB bundle into a
    // -full.nupkg, and the release upload only shipped the 539 KB Setup.exe
    // bootstrapper stub — which cannot install anything without its sibling
    // nupkg — so users got a broken installer. A zip is self-contained.
    new MakerZIP({}, ['win32']),
    // Linux → .deb (Debian/Ubuntu) and .rpm (Fedora/RHEL)
    new MakerDeb({ options: linuxOptions }),
    new MakerRpm({ options: linuxOptions }),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'namespace_selector',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],
};

export default config;
