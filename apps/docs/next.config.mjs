import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import nextra from "nextra";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeSlug from "rehype-slug";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsBasePath =
  process.env.NEXT_PUBLIC_DOCS_BASE_PATH ??
  (process.env.NODE_ENV === "production" ? "/docs" : "");
const normalizedDocsBasePath =
  !docsBasePath || docsBasePath === "/"
    ? ""
    : docsBasePath.startsWith("/")
      ? docsBasePath.replace(/\/$/, "")
      : `/${docsBasePath.replace(/\/$/, "")}`;

const withNextra = nextra({
  search: true,
  // Lets MDX files import other .mdx files (used for helm-values.mdx)
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
  reactStrictMode: true,
  output: "export",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  transpilePackages: ["@workspace/ui", "@workspace/schemas"],
  basePath: normalizedDocsBasePath || undefined,
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default withNextra(nextConfig);
