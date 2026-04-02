import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import '@fastify/multipart';
import type { FastifyRequest } from 'fastify';
import { AssistantService } from '../assistant.service';

@ApiTags('Assistant')
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  @Post('respond')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Respond to a contextual assistant turn',
    description:
      'Accepts the current page context and transcript, returns assistant text plus typed UI actions.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['messages', 'context'],
      properties: {
        messages: {
          type: 'array',
          items: {
            type: 'object',
            required: ['role', 'content'],
            properties: {
              role: {
                type: 'string',
                enum: ['user', 'assistant'],
              },
              content: {
                type: 'string',
              },
            },
          },
        },
        context: {
          type: 'object',
        },
        pendingConfirmation: {
          type: 'object',
          nullable: true,
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      required: ['reply', 'actions', 'pendingConfirmation', 'toolCalls'],
      properties: {
        reply: { type: 'string' },
        actions: { type: 'array', items: { type: 'object' } },
        pendingConfirmation: { type: 'object', nullable: true },
        toolCalls: { type: 'array', items: { type: 'object' } },
      },
    },
  })
  async respond(@Body() body: unknown) {
    return this.assistantService.respond(body);
  }

  @Post('parse-upload')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Parse assistant chat upload',
    description:
      'Accepts csv/tsv/txt/md/log/json file and returns structured payload suitable for assistant context.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiResponse({ status: 200, schema: { type: 'object' } })
  async parseUpload(
    @Req() req: FastifyRequest,
  ): Promise<Record<string, unknown>> {
    let fileBuffer: Buffer | undefined;
    let fileName = 'upload.txt';

    const parts = req.parts();
    for await (const part of parts) {
      if (part.type !== 'file') {
        continue;
      }
      fileBuffer = await part.toBuffer();
      fileName = part.filename ?? fileName;
      break;
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      throw new BadRequestException('No file uploaded.');
    }

    return this.assistantService.parseUploadedFile(fileBuffer, fileName);
  }
}
