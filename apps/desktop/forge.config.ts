import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const allResources = ['api', 'web', 'cli', 'venv', 'python', 'jre'];
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
const osxSign = signingEnabled
  ? (signingIdentity ? { identity: signingIdentity } : {})
  : undefined;
const osxNotarize =
  process.env['APPLE_API_KEY'] && process.env['APPLE_API_KEY_ID'] && process.env['APPLE_API_ISSUER_ID']
    ? {
        appleApiKey: process.env['APPLE_API_KEY'],
        appleApiKeyId: process.env['APPLE_API_KEY_ID'],
        appleApiIssuer: process.env['APPLE_API_ISSUER_ID'],
      }
    : undefined;

const linuxOptions = {
  name: 'classifyre-desktop',
  productName: 'Classifyre',
  genericName: 'Metadata Ingestion',
  description: 'Classifyre Desktop — metadata ingestion for unstructured data sources',
  homepage: 'https://github.com/classifyre/classifyre',
  categories: ['Utility'] as ['Utility'],
  icon: path.resolve(__dirname, 'build/icon.png'),
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
    ...(osxNotarize ? { osxNotarize } : {}),
    ...(extraResource.length > 0 ? { extraResource } : {}),
  },
  makers: [
    // macOS → .dmg
    new MakerDMG({
      icon: path.resolve(__dirname, 'build/icon.icns'),
      format: 'ULFO',
    }),
    // Windows → Classifyre-<version> Setup.exe (Squirrel installer)
    new MakerSquirrel({
      name: 'Classifyre',
      // Squirrel's NuGet packaging requires an author; package.json has none.
      authors: 'Classifyre',
      setupIcon: path.resolve(__dirname, 'build/icon.ico'),
      iconUrl:
        'https://raw.githubusercontent.com/classifyre/classifyre/main/apps/desktop/build/icon.ico',
      noMsi: true,
    }),
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
