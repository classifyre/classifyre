import type * as React from "react";
import Link from "next/link";
import type { MDXComponents } from "nextra/mdx-components";
import { useMDXComponents as getNextraMDXComponents } from "nextra-theme-docs";

import {
  Accordion,
  AccordionCaption,
  AccordionContent,
  AccordionItem,
  AccordionTitle,
  AccordionTrigger,
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Separator,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";

function HeadingOne(props: React.ComponentPropsWithoutRef<"h1">) {
  const { className, ...rest } = props;
  return (
    <h1
      className={cn(
        "scroll-mt-28 font-serif text-4xl font-black uppercase tracking-[0.08em] text-foreground sm:text-5xl",
        className,
      )}
      {...rest}
    />
  );
}

function HeadingTwo(props: React.ComponentPropsWithoutRef<"h2">) {
  const { className, ...rest } = props;
  return (
    <h2
      className={cn(
        "scroll-mt-28 border-b-2 border-border pb-2 font-serif text-2xl font-black uppercase tracking-[0.06em] text-foreground sm:text-3xl",
        className,
      )}
      {...rest}
    />
  );
}

function HeadingThree(props: React.ComponentPropsWithoutRef<"h3">) {
  const { className, ...rest } = props;
  return (
    <h3
      className={cn(
        "scroll-mt-28 font-serif text-xl font-black uppercase tracking-[0.05em] text-foreground sm:text-2xl",
        className,
      )}
      {...rest}
    />
  );
}

function HeadingFour(props: React.ComponentPropsWithoutRef<"h4">) {
  const { className, ...rest } = props;
  return (
    <h4
      className={cn(
        "scroll-mt-28 font-sans text-lg font-semibold uppercase tracking-[0.05em] text-foreground",
        className,
      )}
      {...rest}
    />
  );
}

function HeadingFive(props: React.ComponentPropsWithoutRef<"h5">) {
  const { className, ...rest } = props;
  return (
    <h5
      className={cn(
        "scroll-mt-28 font-sans text-base font-semibold uppercase tracking-[0.04em] text-foreground",
        className,
      )}
      {...rest}
    />
  );
}

function HeadingSix(props: React.ComponentPropsWithoutRef<"h6">) {
  const { className, ...rest } = props;
  return (
    <h6
      className={cn(
        "scroll-mt-28 font-mono text-sm font-semibold uppercase tracking-[0.04em] text-foreground",
        className,
      )}
      {...rest}
    />
  );
}

function Paragraph(props: React.ComponentPropsWithoutRef<"p">) {
  const { className, ...rest } = props;
  return <p className={cn("leading-7 text-foreground", className)} {...rest} />;
}

function UnorderedList(props: React.ComponentPropsWithoutRef<"ul">) {
  const { className, ...rest } = props;
  return (
    <ul
      className={cn("my-6 ml-6 list-disc space-y-2 text-foreground", className)}
      {...rest}
    />
  );
}

function OrderedList(props: React.ComponentPropsWithoutRef<"ol">) {
  const { className, ...rest } = props;
  return (
    <ol
      className={cn(
        "my-6 ml-6 list-decimal space-y-2 text-foreground",
        className,
      )}
      {...rest}
    />
  );
}

function ListItem(props: React.ComponentPropsWithoutRef<"li">) {
  const { className, ...rest } = props;
  return <li className={cn("leading-7", className)} {...rest} />;
}

function BlockQuote(props: React.ComponentPropsWithoutRef<"blockquote">) {
  const { className, ...rest } = props;
  return (
    <blockquote
      className={cn(
        "my-6 border-l-4 border-accent bg-muted/30 px-4 py-3 italic text-foreground",
        className,
      )}
      {...rest}
    />
  );
}

function normalizeHref(href: unknown): string | null {
  if (typeof href === "string") {
    return href;
  }

  if (href instanceof URL) {
    return href.toString();
  }

  if (href && typeof href === "object" && "pathname" in href) {
    const pathname = (href as { pathname?: unknown }).pathname;
    if (typeof pathname === "string") {
      return pathname;
    }
  }

  return null;
}

function Anchor(
  props: Omit<React.ComponentPropsWithoutRef<"a">, "href"> & { href?: unknown },
) {
  const { href, className, children, ...rest } = props;
  const normalizedHref = normalizeHref(href);
  const linkClassName = cn(
    "font-semibold text-foreground underline decoration-accent decoration-2 underline-offset-3 transition-colors hover:bg-accent hover:text-accent-foreground",
    className,
  );

  if (normalizedHref?.startsWith("/")) {
    return (
      <Link href={normalizedHref} className={linkClassName} {...rest}>
        {children}
      </Link>
    );
  }

  if (normalizedHref?.startsWith("#")) {
    return (
      <a href={normalizedHref} className={linkClassName} {...rest}>
        {children}
      </a>
    );
  }

  return (
    <a
      href={normalizedHref ?? undefined}
      className={linkClassName}
      target="_blank"
      rel="noopener noreferrer"
      {...rest}
    >
      {children}
    </a>
  );
}

function HorizontalRule(props: React.ComponentPropsWithoutRef<"hr">) {
  const { className } = props;
  return <Separator className={cn("my-8 h-0.5", className)} />;
}

function TableWrapper(props: React.ComponentPropsWithoutRef<"table">) {
  const { className, ...rest } = props;
  return (
    <div className="my-6 overflow-hidden rounded-[6px] border-2 border-border">
      <Table className={cn("w-full", className)} {...rest} />
    </div>
  );
}

function TableHeaderElement(props: React.ComponentPropsWithoutRef<"thead">) {
  const { className, ...rest } = props;
  return <TableHeader className={cn("bg-muted/40", className)} {...rest} />;
}

function TableBodyElement(props: React.ComponentPropsWithoutRef<"tbody">) {
  const { className, ...rest } = props;
  return <TableBody className={className} {...rest} />;
}

function TableFooterElement(props: React.ComponentPropsWithoutRef<"tfoot">) {
  const { className, ...rest } = props;
  return <TableFooter className={className} {...rest} />;
}

function TableRowElement(props: React.ComponentPropsWithoutRef<"tr">) {
  const { className, ...rest } = props;
  return <TableRow className={className} {...rest} />;
}

function TableHeadElement(props: React.ComponentPropsWithoutRef<"th">) {
  const { className, ...rest } = props;
  return (
    <TableHead
      className={cn(
        "px-3 py-2 font-mono text-xs uppercase tracking-[0.08em]",
        className,
      )}
      {...rest}
    />
  );
}

function TableCellElement(props: React.ComponentPropsWithoutRef<"td">) {
  const { className, ...rest } = props;
  return (
    <TableCell
      className={cn(
        "px-3 py-2 align-top whitespace-normal break-words",
        className,
      )}
      {...rest}
    />
  );
}

function TableCaptionElement(
  props: React.ComponentPropsWithoutRef<"caption">,
) {
  const { className, ...rest } = props;
  return <TableCaption className={className} {...rest} />;
}

const sharedMdxComponents: MDXComponents = {
  Accordion,
  AccordionCaption,
  AccordionContent,
  AccordionItem,
  AccordionTitle,
  AccordionTrigger,
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Separator,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  h1: HeadingOne,
  h2: HeadingTwo,
  h3: HeadingThree,
  h4: HeadingFour,
  h5: HeadingFive,
  h6: HeadingSix,
  p: Paragraph,
  ul: UnorderedList,
  ol: OrderedList,
  li: ListItem,
  blockquote: BlockQuote,
  a: Anchor,
  button: Button,
  hr: HorizontalRule,
  table: TableWrapper,
  thead: TableHeaderElement,
  tbody: TableBodyElement,
  tfoot: TableFooterElement,
  tr: TableRowElement,
  th: TableHeadElement,
  td: TableCellElement,
  caption: TableCaptionElement,
};

export function useMDXComponents(components: MDXComponents) {
  return getNextraMDXComponents({
    ...sharedMdxComponents,
    ...components,
  });
}
