import path from "node:path";
import { Config } from "@remotion/cli/config";
import { enableTailwind } from "@remotion/tailwind-v4";

Config.setEntryPoint("./src/index.ts");
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);

// Every script that reaches this file runs from apps/studio.
const apps = path.resolve(process.cwd(), "..");
const shim = (name: string) => path.resolve(process.cwd(), "src/borrow", name);

/*
 * A video may film a component where it lives in apps/blog or apps/web
 * (`require.context` on its file, see src/borrow/README.md). Those apps write
 * their own imports as `@/…`, which means a different folder in each, so the
 * alias is set per app: it applies to the imports of files under that app and
 * to nothing else. The few modules that cannot run outside Next are swapped
 * for a stand-in from src/borrow.
 */
const borrowed = [
  {
    include: path.join(apps, "blog"),
    resolve: {
      alias: {
        "@/components/finding-tags$": shim("blog-finding-tags.ts"),
        "@workspace/ui/lib/software-version$": shim("blog-software-version.ts"),
        "@": path.join(apps, "blog"),
      },
    },
  },
  {
    include: path.join(apps, "web"),
    resolve: {
      alias: {
        "@/hooks/use-translation$": shim("web-translation.ts"),
        "@": path.join(apps, "web"),
      },
    },
  },
];

Config.overrideBundlerConfig((config) => {
  // The product's theme is Tailwind v4 (`@workspace/ui/globals.css`); without
  // this the shared components render unstyled.
  const styled = enableTailwind(config);
  return {
    ...styled,
    module: {
      ...styled.module,
      rules: [...(styled.module?.rules ?? []), ...borrowed],
    },
    // The studio preview names an imported file after its path. Mr. Fyre's
    // sprites live outside this app (`../../blender`), and a name that climbs
    // out of the bundle cannot be fetched: he would be missing from the
    // preview and present in the render. Name files by their content instead.
    output: { ...styled.output, assetModuleFilename: "[name]-[hash][ext]" },
  };
});
