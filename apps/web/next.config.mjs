import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDesktopBuild = process.env.DESKTOP_BUILD === "true";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: isDesktopBuild ? "export" : "standalone",
  trailingSlash: true,
  ...(!isDesktopBuild && {
    outputFileTracingRoot: path.join(__dirname, "../../"),
  }),
  transpilePackages: ["@workspace/ui"],
  typescript: {
    ignoreBuildErrors: process.env.NEXT_IGNORE_BUILD_ERRORS === "1",
  },
  ...(isDesktopBuild && {
    images: { unoptimized: true },
  }),
};

export default nextConfig;
