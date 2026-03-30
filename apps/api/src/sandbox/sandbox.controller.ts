import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Param,
  Query,
  Req,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiResponse,
  ApiBody,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { SandboxService } from './sandbox.service';
import { QuerySandboxRunsDto } from './dto/query-sandbox-runs.dto';
import { SandboxRunDto } from './dto/sandbox-run.dto';
import { SandboxRunListResponseDto } from './dto/sandbox-run-list-response.dto';

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
| \`TOXIC\` | Toxic / hateful text (Detoxify model) |
| \`NSFW\` | Sexually explicit content |
| \`YARA\` | Custom YARA rule matches |
| \`BROKEN_LINKS\` | Unreachable URLs in text |

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

**Toxic content (multilingual model):**
\`\`\`json
[{"type":"TOXIC","enabled":true,"config":{"enabled_patterns":["toxicity","severe_toxicity","insult"],"model_name":"multilingual"}}]
\`\`\`

**Full scan — all detectors:**
\`\`\`json
[
  {"type":"SECRETS","enabled":true,"config":{}},
  {"type":"PII","enabled":true,"config":{"confidence_threshold":0.7}},
  {"type":"TOXIC","enabled":true,"config":{}},
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

    return this.sandboxService.createRun(
      fileBuffer,
      fileName,
      detectors,
    ) as Promise<SandboxRunDto>;
  }

  @Get('runs')
  @ApiOperation({ summary: 'List sandbox runs (paginated)' })
  @ApiResponse({ status: 200, type: SandboxRunListResponseDto })
  listRuns(
    @Query() query: QuerySandboxRunsDto,
  ): Promise<SandboxRunListResponseDto> {
    return this.sandboxService.listRuns(
      query,
    ) as Promise<SandboxRunListResponseDto>;
  }

  @Get('runs/:id')
  @ApiOperation({ summary: 'Get a sandbox run by ID' })
  @ApiResponse({ status: 200, type: SandboxRunDto })
  getRun(@Param('id') id: string): Promise<SandboxRunDto> {
    return this.sandboxService.getRun(id) as Promise<SandboxRunDto>;
  }

  @Delete('runs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a sandbox run',
    description:
      'Deletes a sandbox run record. If the run is currently in progress the CLI process is killed first.',
  })
  @ApiResponse({ status: 204, description: 'Run deleted' })
  deleteRun(@Param('id') id: string): Promise<void> {
    return this.sandboxService.deleteRun(id);
  }
}
