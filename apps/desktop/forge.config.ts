import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerDeb } from '@electron-forge/maker-deb';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';

const config: ForgeConfig = {
  buildIdentifier: 'classifyre',
  packagerConfig: {
    appBundleId: 'com.classifyre.desktop',
    icon: './build/icon',
    asar: true,
    extraResource: [
      './resources/api',
      './resources/web',
      './resources/cli',
      './resources/prisma',
    ],
  },
  makers: [
    new MakerDMG({
      icon: './build/icon.icns',
    }),
    new MakerSquirrel({
      name: 'Classifyre',
      setupIcon: './build/icon.ico',
    }),
    new MakerDeb({
      options: {
        icon: './build/icon.png',
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
