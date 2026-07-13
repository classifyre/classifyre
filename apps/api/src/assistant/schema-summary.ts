const SCHEMA_SUMMARY_MAX_DEPTH = 4;
const SCHEMA_SUMMARY_MAX_CHARS = 3000;
const SCHEMA_SUMMARY_MAX_ENUMS = 12;
const SCHEMA_SECRET_KEY_RE =
  /(mask|secret|password|token|credential|api[_-]?key)/i;

function describeSchemaType(node: Record<string, unknown>): string {
  if (Array.isArray(node.enum)) {
    const values = node.enum
      .slice(0, SCHEMA_SUMMARY_MAX_ENUMS)
      .map((value) => String(value));
    const suffix = node.enum.length > SCHEMA_SUMMARY_MAX_ENUMS ? '|…' : '';
    return `enum[${values.join('|')}${suffix}]`;
  }
  if (node.const !== undefined) {
    return `const(${JSON.stringify(node.const)})`;
  }
  if (Array.isArray(node.oneOf) || Array.isArray(node.anyOf)) {
    return 'oneOf';
  }
  if (typeof node.type === 'string') {
    return node.type;
  }
  if (Array.isArray(node.type)) {
    return node.type.join('|');
  }
  return 'unknown';
}

/**
 * Produces a compact, token-efficient summary of an already-resolved JSON
 * schema so the LLM knows the exact dot-notation field paths, types, enums,
 * required flags, and which fields are secrets. Walks `properties` directly —
 * schemas arriving from the web app are already $ref/allOf/oneOf-resolved.
 */
export function summarizeSchemaForPrompt(
  schema: Record<string, unknown> | null | undefined,
): string {
  if (!schema || typeof schema !== 'object') {
    return '';
  }

  const lines: string[] = [];

  const walk = (
    node: Record<string, unknown>,
    pathPrefix: string,
    depth: number,
    inheritedSecret: boolean,
  ): void => {
    if (depth > SCHEMA_SUMMARY_MAX_DEPTH) {
      return;
    }

    const properties =
      node.properties && typeof node.properties === 'object'
        ? (node.properties as Record<string, unknown>)
        : null;
    if (!properties) {
      return;
    }

    const requiredKeys = new Set(
      Array.isArray(node.required) ? (node.required as string[]) : [],
    );

    for (const [key, rawChild] of Object.entries(properties)) {
      if (!rawChild || typeof rawChild !== 'object') {
        continue;
      }
      const child = rawChild as Record<string, unknown>;
      const path = pathPrefix ? `${pathPrefix}.${key}` : key;
      const isRequired = requiredKeys.has(key);
      const isSecret =
        inheritedSecret ||
        SCHEMA_SECRET_KEY_RE.test(key) ||
        child.format === 'password' ||
        child.writeOnly === true;

      const childType = typeof child.type === 'string' ? child.type : undefined;
      const childProps =
        child.properties && typeof child.properties === 'object'
          ? (child.properties as Record<string, unknown>)
          : null;

      // Nested object → recurse, do not emit a leaf line for the container.
      if (childType === 'object' || childProps) {
        walk(child, path, depth + 1, isSecret);
        continue;
      }

      // Array of objects → recurse into items with a [] marker.
      if (childType === 'array') {
        const items =
          child.items && typeof child.items === 'object'
            ? (child.items as Record<string, unknown>)
            : null;
        if (items && items.properties) {
          walk(items, `${path}[]`, depth + 1, isSecret);
          continue;
        }
        const itemType = items ? describeSchemaType(items) : 'any';
        lines.push(
          formatSchemaLine(
            path,
            `array<${itemType}>`,
            isRequired,
            isSecret,
            child,
          ),
        );
        continue;
      }

      lines.push(
        formatSchemaLine(
          path,
          describeSchemaType(child),
          isRequired,
          isSecret,
          child,
        ),
      );
    }
  };

  walk(schema, '', 0, false);

  if (lines.length === 0) {
    return '';
  }

  const joined = lines.join('\n');
  if (joined.length <= SCHEMA_SUMMARY_MAX_CHARS) {
    return joined;
  }
  return `${joined.slice(0, SCHEMA_SUMMARY_MAX_CHARS)}\n…(truncated)…`;
}

function formatSchemaLine(
  path: string,
  typeLabel: string,
  isRequired: boolean,
  isSecret: boolean,
  node: Record<string, unknown>,
): string {
  const flags = [isRequired ? '(required)' : '', isSecret ? '(secret)' : '']
    .filter(Boolean)
    .join(' ');
  const description =
    typeof node.description === 'string' && node.description.trim().length > 0
      ? ` — ${node.description.trim().slice(0, 120)}`
      : '';
  return `  ${path} : ${typeLabel}${flags ? ` ${flags}` : ''}${description}`;
}

export function safeJsonStringify(value: unknown, maxChars: number): string {
  try {
    const json = JSON.stringify(value, null, 2);
    if (json.length <= maxChars) {
      return json;
    }
    return `${json.slice(0, maxChars)}\n…(truncated)…`;
  } catch {
    return String(value);
  }
}
