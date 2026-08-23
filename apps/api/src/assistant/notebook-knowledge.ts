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
 * Rendered so the assistant stops writing an import for a package nobody
 * declared. Only the "always" group is importable with nothing declared;
 * everything else — including a backend a library reaches for internally, like
 * openpyxl under `pandas.read_excel` — has to be in `optional.packages` or the
 * cell dies on an ImportError the model then cannot explain.
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
    `Already in the image, import them with nothing declared: ${
      always.join(', ') || '(none)'
    }`,
    `Known to the installer (a declaration resolves to this version): ${
      onDemand.join(', ') || '(none)'
    }`,
    '',
    'DECLARE EVERY OTHER IMPORT in `optional.packages`, with patch_fields, in',
    'the SAME reply that writes the import — as',
    '[{"name":"pandas"},{"name":"openpyxl"}]. Omit "version" unless the user',
    'asked for one: a pinned version that does not exist fails the whole run.',
    '',
    'Declare the libraries an import needs underneath it too, not just the one',
    'you typed. These are the ones that actually bite:',
    '  pandas reading .xlsx  -> also openpyxl',
    '  pandas reading .xls   -> also xlrd',
    '  pandas reading parquet-> also pyarrow',
    'An "ImportError: `Import openpyxl` failed" from inside pandas means exactly',
    'this: add the missing name to optional.packages and run again.',
  ].join('\n');
}
