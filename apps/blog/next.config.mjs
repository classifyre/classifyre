import path from "node:path";
import { fileURLToPath } from "node:url";
import nextra from "nextra";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeSlug from "rehype-slug";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const withNextra = nextra({
  search: true,
  mdxOptions: {
    remarkPlugins: [],
    rehypePlugins: [
      rehypeSlug,
      [
        rehypeAutolinkHeadings,
        {
          behavior: "wrap",
          properties: {
            className: ["anchor"],
          },
        },
      ],
    ],
  },
  defaultShowCopyCode: true,
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  transpilePackages: ["@workspace/ui"],
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default withNextra(nextConfig);
