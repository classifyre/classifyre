# Marketing site and blog

`apps/blog` is the marketing site (classifyre.com) and its publication.

## Narrative

Classifyre is sold as **open-source data access governance platform**: the
one governed way into an organisation's data. Every page tells it in the
same order, and copy in `content/` (landing, topics, get, sources) follows it:

1. **Access follows your organisation**: groups, departments and roles from
   the directory decide tables, rows and columns.
2. **Sensitive data is masked by default**: classification decides what is
   personal; masks apply inside the query.
3. **Teams build data products on governed data**: shared datasets, masks as
   a floor. "Data product" is always explained as a shared dataset.
4. **People use it in the tools they have**: SQL, Excel, Power BI, AI agents
   over MCP, on personal connections.
5. **Every read is on record, and nothing leaves your servers.**

Discovery is the first step of masking, never the headline. Investigation
(cases, autopilot) is a use case with its own page
(`/use-cases/incident-response`). Retired phrases: "Find it. Protect it. Use
it.", "query everything", a bare "platform" (the allowed name is the full
"Open-source data access governance platform"). There is no "Enterprise"
edition and no OpenShift upsell anywhere in the copy: help with setup or
tailoring is a contact (see `/support`), not a tier. Regulations are
"supported", never "compliant". The word rules live at the top of
`content/landing.ts`.

## Blog authoring

The publication has two sections under `app/blog`:

- `articles/` contains the non-technical business blog about Classifyre,
  governed data access, investigation work, evidence, and decision-making.
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
