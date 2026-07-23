import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { NamespaceRegistryService } from './namespace-registry.service';
import type {
  CreateNamespaceInput,
  Namespace,
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

  @Get(':id')
  @ApiOperation({ summary: 'Get a namespace by id' })
  get(@Param('id') id: string): Promise<Namespace> {
    return this.registry.get(id);
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
    summary: 'Delete a namespace (drops its schema and pg-boss schema)',
  })
  async remove(@Param('id') id: string): Promise<void> {
    await this.registry.remove(id);
  }
}
