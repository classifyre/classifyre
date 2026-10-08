import { Config } from "@remotion/cli/config";
import { enableTailwind } from "@remotion/tailwind-v4";

Config.setEntryPoint("./src/index.ts");
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);

Config.overrideBundlerConfig((config) => {
  // The product's theme is Tailwind v4 (`@workspace/ui/globals.css`); without
  // this the shared components render unstyled.
  const styled = enableTailwind(config);
  return {
    ...styled,
    // The studio preview names an imported file after its path. Mr. Fyre's
    // sprites live outside this app (`../../blender`), and a name that climbs
    // out of the bundle cannot be fetched: he would be missing from the
    // preview and present in the render. Name files by their content instead.
    output: { ...styled.output, assetModuleFilename: "[name]-[hash][ext]" },
  };
});
