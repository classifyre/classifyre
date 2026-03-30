import type { MDXComponents } from "nextra/mdx-components";
import { useMDXComponents as getNextraMDXComponents } from "nextra-theme-docs";

export function useMDXComponents(components: MDXComponents) {
  return getNextraMDXComponents(components);
}
