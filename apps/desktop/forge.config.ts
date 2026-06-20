import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerDeb } from '@electron-forge/maker-deb';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const allResources = ['api', 'web', 'cli', 'prisma'];
const extraResource = allResources
  .map((name) => path.resolve(__dirname, 'resources', name))
  .filter((abs) => fs.existsSync(abs));

const config: ForgeConfig = {
  buildIdentifier: 'classifyre',
  packagerConfig: {
    appBundleId: 'com.classifyre.desktop',
    icon: path.resolve(__dirname, 'build/icon'),
    asar: true,
    ...(extraResource.length > 0 ? { extraResource } : {}),
  },
  makers: [
    new MakerDMG({
      icon: path.resolve(__dirname, 'build/icon.icns'),
    }),
    new MakerSquirrel({
      name: 'Classifyre',
      setupIcon: path.resolve(__dirname, 'build/icon.ico'),
    }),
    new MakerDeb({
      options: {
        icon: path.resolve(__dirname, 'build/icon.png'),
      },
    }),
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
