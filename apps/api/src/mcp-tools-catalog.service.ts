import { Injectable } from '@nestjs/common';
import * as z from 'zod';
import { MCP_CAPABILITY_GROUPS } from './mcp-catalog';
import { McpServerFactoryService } from './mcp-server.factory';
import { McpToolParameterDto, McpToolSummaryDto } from './dto/mcp-settings.dto';

/** Shape of the SDK's private tool registry entry we introspect. */
interface RegisteredToolLike {
  title?: string;
  description?: string;
  inputSchema?: z.ZodTypeAny;
  outputSchema?: z.ZodTypeAny;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
  };
  enabled?: boolean;
}

interface JsonSchemaProperty {
  type?: string | string[];
  description?: string;
  format?: string;
  enum?: unknown[];
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  items?: JsonSchemaProperty;
}

interface ObjectJsonSchema {
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

/** Nested object params (e.g. `filters`, `page`) are flattened one level deep
 * with dotted names so the settings UI can show their fields. */
const MAX_PARAM_DEPTH = 2;

/**
 * Builds the MCP tool catalog for the settings UI directly from the tools that
 * {@link McpServerFactoryService} registers with the MCP server. There is no
 * second copy of the tool definitions: names, descriptions, annotations, and
 * input schemas are read back from the built server so the settings page always
 * reflects exactly what MCP clients see.
 */
@Injectable()
export class McpToolsCatalogService {
  private cache: McpToolSummaryDto[] | null = null;

  constructor(private readonly factory: McpServerFactoryService) {}

  getTools(): McpToolSummaryDto[] {
    if (!this.cache) {
      this.cache = this.buildTools();
    }
    return this.cache;
  }

  private buildTools(): McpToolSummaryDto[] {
    const server = this.factory.createServer();
    const registered = (
      server as unknown as {
        _registeredTools: Record<string, RegisteredToolLike>;
      }
    )._registeredTools;

    const groupByToolName = new Map<string, { id: string; title: string }>();
    for (const group of MCP_CAPABILITY_GROUPS) {
      for (const toolName of group.toolNames) {
        groupByToolName.set(toolName, { id: group.id, title: group.title });
      }
    }

    const tools = Object.entries(registered)
      .filter(([, tool]) => tool.enabled !== false)
      .map(([name, tool]) => {
        const group = groupByToolName.get(name);
        const annotations = tool.annotations ?? {};
        return {
          name,
          title: tool.title,
          description: tool.description,
          groupId: group?.id,
          groupTitle: group?.title,
          readOnly: annotations.readOnlyHint ?? false,
          destructive: annotations.destructiveHint ?? false,
          idempotent: annotations.idempotentHint ?? false,
          parameters: this.extractParameters(tool.inputSchema),
          returnsJson: true,
        } satisfies McpToolSummaryDto;
      });

    tools.sort((a, b) => a.name.localeCompare(b.name));
    return tools;
  }

  private extractParameters(
    inputSchema: z.ZodTypeAny | undefined,
  ): McpToolParameterDto[] {
    if (!inputSchema) {
      return [];
    }

    let jsonSchema: ObjectJsonSchema;
    try {
      jsonSchema = z.toJSONSchema(inputSchema, {
        io: 'input',
        unrepresentable: 'any',
      }) as ObjectJsonSchema;
    } catch {
      return [];
    }

    return this.flattenProperties(jsonSchema, '', 1);
  }

  /** Walk a JSON-Schema object's properties into flat parameter rows, recursing
   * into nested objects with dotted names (e.g. `filters.severity`). */
  private flattenProperties(
    schema: ObjectJsonSchema | JsonSchemaProperty,
    prefix: string,
    depth: number,
  ): McpToolParameterDto[] {
    const properties = schema.properties ?? {};
    const required = new Set(schema.required ?? []);

    return Object.entries(properties).flatMap(([key, prop]) => {
      const name = prefix ? `${prefix}.${key}` : key;
      const rawEnum = Array.isArray(prop.enum)
        ? prop.enum
        : Array.isArray(prop.items?.enum)
          ? prop.items.enum
          : undefined;
      const enumValues = rawEnum?.map((value) => String(value));

      const row: McpToolParameterDto = {
        name,
        type: this.describeType(prop),
        required: required.has(key),
        description: prop.description,
        format: prop.format,
        enumValues:
          enumValues && enumValues.length > 0 ? enumValues : undefined,
      };

      const nested =
        depth < MAX_PARAM_DEPTH && prop.properties
          ? this.flattenProperties(prop, name, depth + 1)
          : [];

      return [row, ...nested];
    });
  }

  private describeType(schema: JsonSchemaProperty): string {
    if (Array.isArray(schema.enum) && schema.enum.length > 0) {
      return 'enum';
    }
    if (schema.type === 'array') {
      const items = schema.items;
      if (items && Array.isArray(items.enum) && items.enum.length > 0) {
        return 'enum[]';
      }
      const itemType = items ? this.describeType(items) : 'unknown';
      return `${itemType}[]`;
    }
    if (Array.isArray(schema.type)) {
      return schema.type.join(' | ') || 'unknown';
    }
    return schema.type ?? 'unknown';
  }
}
