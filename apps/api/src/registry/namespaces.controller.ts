import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { NamespaceRegistryService } from './namespace-registry.service';
import type {
  CreateNamespaceInput,
  Namespace,
  NamespaceStats,
  UpdateNamespaceInput,
} from './namespace.types';

/**
 * Namespace (tenant) registry CRUD.
 *
 * `namespaces` is a RESERVED first path segment (see `RESERVED_PREFIXES`): these
 * routes are NOT namespace-scoped — they run against the `public` registry, not
 * a tenant schema — so the request pipeline lets them pass through untouched.
 * Used by the web landing page to list/create/select/delete namespaces.
 */
@ApiTags('Namespaces')
@Controller('namespaces')
export class NamespacesController {
  constructor(private readonly registry: NamespaceRegistryService) {}

  @Get()
  @ApiOperation({ summary: 'List all namespaces' })
  list(): Promise<Namespace[]> {
    return this.registry.list();
  }

  @Post()
  @ApiOperation({
    summary: 'Create a namespace (provisions its Postgres schema + migrations)',
  })
  create(@Body() body: CreateNamespaceInput): Promise<Namespace> {
    return this.registry.create(body);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Per-namespace source rollups (total + failing)' })
  stats(): Promise<NamespaceStats[]> {
    return this.registry.stats();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a namespace by id' })
  get(@Param('id') id: string): Promise<Namespace> {
    return this.registry.get(id);
  }

  @Get(':id/thumbnail')
  @ApiOperation({ summary: "Stream a namespace's thumbnail image" })
  async thumbnail(
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const image = await this.registry.getThumbnail(id);
    if (!image) {
      throw new NotFoundException('Namespace has no thumbnail');
    }
    await reply
      .header('Cache-Control', 'private, max-age=0, must-revalidate')
      .type(image.mime)
      .send(image.blob);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a namespace' })
  update(
    @Param('id') id: string,
    @Body() body: UpdateNamespaceInput,
  ): Promise<Namespace> {
    return this.registry.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Soft-delete a namespace (hidden from listings; data retained)',
  })
  async remove(@Param('id') id: string): Promise<void> {
    await this.registry.remove(id);
  }
}
