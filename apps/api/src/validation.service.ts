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
    addFormats(this.ajv as any);

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
