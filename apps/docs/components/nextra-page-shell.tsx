import type { Heading } from "nextra";
import { useMDXComponents } from "nextra-theme-docs";

type NextraPageShellProps = {
  title: string;
  filePath: string;
  toc?: Array<{ id: string; value: string }>;
  sourceCode?: string;
  children: React.ReactNode;
};

export function NextraPageShell({
  title,
  filePath,
  toc = [],
  sourceCode = "",
  children,
}: NextraPageShellProps) {
  const components = useMDXComponents({});
  const Wrapper = components.wrapper;

  const normalizedToc: Heading[] = toc.map((item) => ({
    id: item.id,
    value: item.value,
    depth: 2,
  }));

  return (
    <Wrapper
      toc={normalizedToc}
      metadata={{
        title,
        filePath,
      }}
      sourceCode={sourceCode}
    >
      <div className="text-foreground">{children}</div>
    </Wrapper>
  );
}
