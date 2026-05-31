import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Param,
  Query,
  Req,
  Res,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiResponse,
  ApiBody,
} from '@nestjs/swagger';
import '@fastify/multipart';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { SandboxService } from './sandbox.service';
import { QuerySandboxRunsDto } from './dto/query-sandbox-runs.dto';
import { SandboxRunDto } from './dto/sandbox-run.dto';
import { SandboxRunListResponseDto } from './dto/sandbox-run-list-response.dto';
import { RerunSandboxRunDto } from './dto/rerun-sandbox-run.dto';

@ApiTags('Sandbox')
@Controller('sandbox')
export class SandboxController {
  constructor(private readonly sandboxService: SandboxService) {}

  @Post('runs')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Upload a file and run detectors on it',
    description: `Upload any local file (PDF, DOCX, XLSX, TXT, CSV, HTML, JSON, …) and run one
or more detectors against its extracted text.

**\`detectors\`** is a JSON string containing an array of detector config objects.
Each object has the shape:
\`\`\`json
{ "type": "<TYPE>", "enabled": true, "config": { ... } }
\`\`\`

### Detector types & sample configs

| Type | What it finds |
|------|---------------|
| \`SECRETS\` | API keys, tokens, private keys |
| \`PII\` | Emails, SSNs, credit cards, phone numbers |
| \`YARA\` | Custom YARA rule matches |
| \`BROKEN_LINKS\` | Unreachable URLs in text |
| \`CUSTOM\` | User-defined pipelines (REGEX, GLiNER2, HuggingFace transformers) |

**Minimal — secrets only (all patterns):**
\`\`\`json
[{"type":"SECRETS","enabled":true,"config":{}}]
\`\`\`

**PII with specific patterns:**
\`\`\`json
[{"type":"PII","enabled":true,"config":{"enabled_patterns":["email","credit_card","ssn","phone_number"],"confidence_threshold":0.8}}]
\`\`\`

**Secrets + PII combined:**
\`\`\`json
[
  {"type":"SECRETS","enabled":true,"config":{"enabled_patterns":["aws","github","stripe","generic_api_key"]}},
  {"type":"PII","enabled":true,"config":{"enabled_patterns":["email","ssn","credit_card"],"confidence_threshold":0.75}}
]
\`\`\`

**Full scan — all detectors:**
\`\`\`json
[
  {"type":"SECRETS","enabled":true,"config":{}},
  {"type":"PII","enabled":true,"config":{"confidence_threshold":0.7}},
  {"type":"BROKEN_LINKS","enabled":true,"config":{}}
]
\`\`\``,
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'detectors'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'File to scan' },
        detectors: {
          type: 'string',
          description: 'JSON array of detector config objects',
          example: JSON.stringify([
            {
              type: 'SECRETS',
              enabled: true,
              config: {
                enabled_patterns: [
                  'aws',
                  'github',
                  'stripe',
                  'generic_api_key',
                ],
              },
            },
            {
              type: 'PII',
              enabled: true,
              config: {
                enabled_patterns: [
                  'email',
                  'credit_card',
                  'ssn',
                  'phone_number',
                ],
                confidence_threshold: 0.75,
              },
            },
          ]),
        },
      },
    },
  })
  @ApiResponse({ status: 201, type: SandboxRunDto })
  @ApiResponse({
    status: 409,
    description: 'Conflict — a run with the same file content already exists',
  })
  async createRun(@Req() req: FastifyRequest): Promise<SandboxRunDto> {
    let fileBuffer: Buffer | undefined;
    let fileName = 'upload';
    let detectorsRaw = '[]';

    // Consume all parts; use toBuffer() on file parts to avoid
    // ERR_STREAM_PREMATURE_CLOSE from abandoned readable streams.
    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === 'file') {
        fileBuffer = await part.toBuffer();
        fileName = part.filename ?? 'upload';
      } else if (part.type === 'field' && part.fieldname === 'detectors') {
        detectorsRaw = String(part.value);
      }
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      throw new BadRequestException('No file uploaded');
    }

    let detectors: unknown[];
    try {
      detectors = JSON.parse(detectorsRaw) as unknown[];
      if (!Array.isArray(detectors)) {
        throw new Error('detectors must be a JSON array');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new BadRequestException(`Invalid detectors JSON: ${msg}`);
    }

    return this.sandboxService.createRun(fileBuffer, fileName, detectors);
  }

  @Get('runs')
  @ApiOperation({ summary: 'List sandbox runs (paginated)' })
  @ApiResponse({ status: 200, type: SandboxRunListResponseDto })
  listRuns(
    @Query() query: QuerySandboxRunsDto,
  ): Promise<SandboxRunListResponseDto> {
    return this.sandboxService.listRuns(query);
  }

  @Get('runs/:id')
  @ApiOperation({ summary: 'Get a sandbox run by ID' })
  @ApiResponse({ status: 200, type: SandboxRunDto })
  getRun(@Param('id') id: string): Promise<SandboxRunDto> {
    return this.sandboxService.getRun(id);
  }

  @Get('runs/:id/input')
  @ApiOperation({
    summary: 'Download the staged input file for an in-flight sandbox run',
    description:
      'Internal endpoint used by the Kubernetes sandbox job init-container to fetch the input file over the cluster network. Available only while the file is staged (during the run).',
  })
  async getRunInput(
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const { data, contentType, fileName } =
      await this.sandboxService.getInputData(id);
    await reply
      .header('Content-Type', contentType)
      .header('Content-Length', String(data.length))
      .header('Content-Disposition', `attachment; filename="${fileName}"`)
      .send(data);
  }

  @Post('runs/:id/rerun')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Re-run a sandbox run with different detectors',
    description: `Creates a new sandbox run using the same uploaded file as an existing run
but with a different set of detectors. Requires S3 storage to be configured so
the original file can be retrieved. The original run is not modified.`,
  })
  @ApiBody({ type: RerunSandboxRunDto })
  @ApiResponse({
    status: 201,
    type: SandboxRunDto,
    description: 'New run created from the original file',
  })
  @ApiResponse({
    status: 409,
    description:
      'Conflict — identical file already has a non-error run (only when skipDuplicateCheck is false)',
  })
  rerunRun(
    @Param('id') id: string,
    @Body() dto: RerunSandboxRunDto,
  ): Promise<SandboxRunDto> {
    return this.sandboxService.rerunRun(id, dto.detectors ?? []);
  }

  @Delete('runs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a sandbox run',
    description:
      'Deletes a sandbox run record and its associated S3 file (if no other runs share it). If the run is currently in progress the CLI process is killed first.',
  })
  @ApiResponse({ status: 204, description: 'Run deleted' })
  deleteRun(@Param('id') id: string): Promise<void> {
    return this.sandboxService.deleteRun(id);
  }
}
