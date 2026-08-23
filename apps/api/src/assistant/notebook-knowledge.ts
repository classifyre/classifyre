import completions from '@workspace/schemas/notebook_completions';
import runtimePackages from '@workspace/schemas/notebook_runtime_packages';

/**
 * The notebook SDK, rendered for the assistant.
 *
 * Generated from `apps/cli/src/notebook/sdk.py` — the same manifest the
 * editor's autocomplete reads — so the model is told about the API that exists
 * today rather than one described in a prompt somebody forgot to update. This
 * matters more than it looks: without it a model reliably writes
 * `ctx.files["report.xlsx"]`, which is a TypeError because `ctx.files` is a
 * list, and then cannot work out why.
 */

interface CompletionManifest {
  objects: Record<
    string,
    {
      members: Array<{
        label: string;
        kind: string;
        detail?: string;
        documentation?: string;
      }>;
    }
  >;
  classes: Record<
    string,
    {
      fields: Array<{ label: string; detail?: string; required?: boolean }>;
      members?: Array<{ label: string; kind: string; detail?: string }>;
    }
  >;
}

interface RuntimePackageManifest {
  pythonVersion: string;
  packages: Array<{
    name: string;
    version: string;
    modules: string[];
    availability: string;
    group?: string;
  }>;
}

const manifest = completions as unknown as CompletionManifest;
const runtime = runtimePackages as unknown as RuntimePackageManifest;

function renderObject(name: string): string {
  const members = manifest.objects[name]?.members ?? [];
  return members
    .map((member) => {
      const signature =
        member.kind === 'property'
          ? `  ${name}.${member.label}  ->  ${member.detail ?? 'value'}`
          : `  ${name}.${member.label}${member.detail ?? '()'}`;
      // The first line of the docstring is what disambiguates a list from a
      // lookup, so it is worth the tokens.
      const summary = member.documentation?.split('\n')[0]?.trim();
      return summary ? `${signature}\n      ${summary}` : signature;
    })
    .join('\n');
}

function renderClass(name: string): string {
  const definition = manifest.classes[name];
  if (!definition) return '';
  const fields = definition.fields
    .map(
      (field) =>
        `  ${field.label}: ${field.detail ?? 'Any'}${field.required ? '  (required)' : ''}`,
    )
    .join('\n');
  const members = (definition.members ?? [])
    .map((member) => `  .${member.label}${member.detail ?? '()'}`)
    .join('\n');
  return [fields, members].filter(Boolean).join('\n');
}

/** The SDK surface: `ctx`, `Asset(...)`, and the attached-file object. */
export function notebookSdkSurface(): string {
  const sections = [
    'Available in every cell, with or without importing:',
    '    from classifyre import Asset, ctx, parse',
    '',
    'ctx:',
    renderObject('ctx'),
  ];

  const assetFields = renderClass('Asset');
  if (assetFields) {
    sections.push('', 'Asset(...):', assetFields);
  }

  for (const name of Object.keys(manifest.classes)) {
    if (name === 'Asset') continue;
    const body = renderClass(name);
    if (body) sections.push('', `${name}:`, body);
  }

  return sections.join('\n');
}

/**
 * Packages already in the scan runtime.
 *
 * Rendered so the assistant stops declaring a package that is already there,
 * and stops writing an import for one that is not. "always" packages can be
 * imported with nothing declared; "on-demand" ones install on first import; a
 * name in neither list has to be added to `optional.packages`.
 */
export function notebookRuntimePackages(): string {
  const always: string[] = [];
  const onDemand: string[] = [];
  for (const entry of runtime.packages) {
    const label = `${entry.name}${entry.version ? ` ${entry.version}` : ''}`;
    (entry.availability === 'always' ? always : onDemand).push(label);
  }
  return [
    `Python ${runtime.pythonVersion} runtime.`,
    `Always importable (do NOT declare these): ${always.join(', ') || '(none)'}`,
    `Installed on first import (declaring them is harmless but unnecessary): ${
      onDemand.join(', ') || '(none)'
    }`,
    'ANYTHING ELSE — pandas, openpyxl, pyarrow, … — must be added to',
    '`optional.packages` with patch_fields in the SAME reply that imports it,',
    'as [{"name":"pandas"},{"name":"openpyxl"}]. Omit "version" unless the user',
    'asked for one: a pinned version that does not exist fails the whole run.',
  ].join('\n');
}
