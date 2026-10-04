import { Config } from "@remotion/cli/config";
import { enableTailwind } from "@remotion/tailwind-v4";

Config.setEntryPoint("./src/index.ts");
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);

// The product's theme is Tailwind v4 (`@workspace/ui/globals.css`); without
// this the shared components render unstyled.
Config.overrideBundlerConfig((config) => enableTailwind(config));
