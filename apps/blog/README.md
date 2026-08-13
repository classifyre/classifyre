# Blog authoring

The publication has two sections under `app/blog`:

- `articles/` contains the non-technical business blog about Classifyre,
  investigation work, evidence, and decision-making.
- `cases/` contains evidence-led field notes from real public investigations.

The `/blog` route is the publication overview. Each section also has its own
listing page and appears in the Nextra Blog menu in the site header. The global
adapter in `mdx-components.tsx` renders ordinary Markdown with the shared
Classifyre UI system.

## Automatic Markdown components

Standard Markdown needs no imports. Headings, paragraphs, lists, blockquotes,
links, horizontal rules, and tables are mapped automatically. Table markup is
rendered with the `Table` primitives from `@workspace/ui`, while headings and
body copy use the same design tokens as the rest of the site.

```md
## Detector results

| Detector | Findings |
| --- | ---: |
| PII | 120 |
| Secrets | 8 |
```

## Components available in MDX

The adapter also makes the commonly used `@workspace/ui` components available
to every article without a per-file import. Use PascalCase for composed
components:

```mdx
<Button variant="secondary">Review findings</Button>

<Card>
  <CardHeader>
    <CardTitle>Investigation status</CardTitle>
    <CardDescription>Updated after every scan.</CardDescription>
  </CardHeader>
  <CardContent>Eight cases remain open.</CardContent>
</Card>
```

Available families include `Alert`, `Badge`, `Button`, `Card`, `Table`, `Tabs`,
`Accordion`, and `Separator`, together with their child components. Authors can
still import a specialized component directly in an MDX file when it is not in
the global adapter.

Components passed explicitly by an individual MDX renderer take precedence over
the global mappings.
