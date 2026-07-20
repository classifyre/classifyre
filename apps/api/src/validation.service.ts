import { Injectable, BadRequestException } from '@nestjs/common';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import * as fs from 'fs';
import * as path from 'path';
import { normalizeSourceConfig } from './utils/source-config-normalizer';
import { resolveSchemasDir } from './utils/schema-path';

@Injectable()
export class ValidationService {
  private ajv: Ajv;
  private schemaPath: string;
  private inputSchema: any;
  private outputSchema: any;
  private detectorSchema: any;
  private inputValidator: any;
  private outputValidator: any;
  private detectorValidator: any;

  constructor() {
    this.ajv = new Ajv({
      allErrors: true,
      strict: false,
    });
    addFormats(this.ajv);

    // Resolve schema path so it works from both src and dist runtimes.
    this.schemaPath = resolveSchemasDir(__dirname);

    this.loadSchemas();
  }

  private loadSchemas() {
    // Load merged schema files - all self-contained with internal references
    const inputSchemaPath = path.join(
      this.schemaPath,
      'all_input_sources.json',
    );
    const outputSchemaPath = path.join(
      this.schemaPath,
      'single_asset_scan_results.json',
    );
    const detectorSchemaPath = path.join(this.schemaPath, 'all_detectors.json');

    if (!fs.existsSync(inputSchemaPath)) {
      throw new Error(`Input schema not found: ${inputSchemaPath}`);
    }
    if (!fs.existsSync(outputSchemaPath)) {
      throw new Error(`Output schema not found: ${outputSchemaPath}`);
    }
    if (!fs.existsSync(detectorSchemaPath)) {
      throw new Error(`Detector schema not found: ${detectorSchemaPath}`);
    }

    // Load and compile schemas
    this.inputSchema = JSON.parse(fs.readFileSync(inputSchemaPath, 'utf8'));
    this.outputSchema = JSON.parse(fs.readFileSync(outputSchemaPath, 'utf8'));
    this.detectorSchema = JSON.parse(
      fs.readFileSync(detectorSchemaPath, 'utf8'),
    );

    // Compile validators - schemas are self-contained with #/definitions references
    this.inputValidator = this.ajv.compile(this.inputSchema);
    this.outputValidator = this.ajv.compile(this.outputSchema);
    this.detectorValidator = this.ajv.compile(this.detectorSchema);
  }

  /**
   * Validate input configuration for a source type
   * The schema uses oneOf to support all source types, validation is automatic
   */
  validate(type: string, data: any): Record<string, unknown> {
    if (String(type).toUpperCase() === 'LOCAL_FOLDER') {
      const environment = (
        process.env.ENVIRONMENT || 'development'
      ).toLowerCase();
      if (environment === 'kubernetes') {
        throw new BadRequestException(
          'LOCAL_FOLDER sources are only available in the desktop application',
        );
      }
    }
    const normalized = normalizeSourceConfig(type, data);
    const valid = this.inputValidator(normalized);
    if (!valid) {
      throw new BadRequestException(
        this.ajv.errorsText(this.inputValidator.errors),
      );
    }
    return normalized;
  }

  /**
   * The source types the input schema accepts: the `type` const plus a human
   * label per oneOf branch. Drives the MCP list_source_types tool.
   */
  listSourceTypes(): Array<{ type: string; label: string }> {
    const defs = (this.inputSchema.definitions ?? {}) as Record<string, any>;
    const out: Array<{ type: string; label: string }> = [];
    for (const branch of this.inputSchema.oneOf ?? []) {
      const ref = typeof branch?.$ref === 'string' ? branch.$ref : '';
      const def = defs[ref.replace('#/definitions/', '')];
      if (!def) continue;
      const typeConst = this.findTypeConst(def);
      if (typeConst) {
        out.push({ type: typeConst, label: String(def.label ?? typeConst) });
      }
    }
    return out;
  }

  /**
   * The fully dereferenced config schema for one source type — everything an
   * agent needs to build a valid create_source/update_source config without
   * guessing field names. Throws BadRequest on unknown types.
   */
  getSourceTypeSchema(type: string): Record<string, unknown> {
    const defs = (this.inputSchema.definitions ?? {}) as Record<string, any>;
    const wanted = String(type).trim().toUpperCase();
    for (const branch of this.inputSchema.oneOf ?? []) {
      const ref = typeof branch?.$ref === 'string' ? branch.$ref : '';
      const def = defs[ref.replace('#/definitions/', '')];
      if (!def) continue;
      if (this.findTypeConst(def)?.toUpperCase() === wanted) {
        return this.dereference(def, defs, 0) as Record<string, unknown>;
      }
    }
    const known = this.listSourceTypes()
      .map((t) => t.type)
      .join(', ');
    throw new BadRequestException(
      `Unknown source type "${type}". Known types: ${known}.`,
    );
  }

  /** Depth-first search for the `type: {const: …}` marker of a oneOf branch. */
  private findTypeConst(def: any): string | null {
    for (const part of def.allOf ?? [def]) {
      const typeProp = part?.properties?.type;
      if (typeof typeProp?.const === 'string') return typeProp.const;
    }
    return null;
  }

  /** Inline $refs (cycle- and depth-guarded) so agents see one flat schema. */
  private dereference(
    node: any,
    defs: Record<string, any>,
    depth: number,
  ): any {
    if (depth > 12 || node === null || typeof node !== 'object') return node;
    if (Array.isArray(node)) {
      return node.map((item) => this.dereference(item, defs, depth + 1));
    }
    if (typeof node.$ref === 'string') {
      const target = defs[node.$ref.replace('#/definitions/', '')];
      if (!target) return node;
      return this.dereference(target, defs, depth + 1);
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = this.dereference(value, defs, depth + 1);
    }
    return out;
  }

  /**
   * Validate output/asset data
   */
  validateOutput(type: string, data: any) {
    const valid = this.outputValidator(data);
    if (!valid) {
      throw new BadRequestException(
        this.ajv.errorsText(this.outputValidator.errors),
      );
    }
  }

  /**
   * Validate detector configuration
   * The schema uses oneOf to support all detector types, validation is automatic
   * @param detectorType - Detector type (SECRETS, PII, etc.) - kept for compatibility but not used
   * @param config - Detector configuration object
   */
  validateDetectorConfig(detectorType: string, config: any) {
    const valid = this.detectorValidator(config);
    if (!valid) {
      throw new BadRequestException(
        this.ajv.errorsText(this.detectorValidator.errors),
      );
    }
  }
}
