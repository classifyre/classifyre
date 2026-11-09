import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CapabilityRequiredException } from '../identity/access.guard';
import type { Capability } from '../identity/capabilities';
import type { IdentityService, Principal } from '../identity/identity.service';
import { IDENTITY } from '../identity/identity.tokens';
import { TenancyService } from '../identity/tenancy.service';
import { NamespaceRegistryService } from './namespace-registry.service';
import type {
  CreateNamespaceCategoryInput,
  CreateNamespaceInput,
  Namespace,
  NamespaceCategory,
  NamespaceStats,
  UpdateNamespaceCategoryInput,
  UpdateNamespaceInput,
} from './namespace.types';
import { AccessArea, Requires } from '../identity/access.decorators';

/**
 * Namespace (tenant) registry CRUD.
 *
 * `namespaces` is a RESERVED first path segment (see `RESERVED_PREFIXES`): these
 * routes are NOT namespace-scoped — they run against the `public` registry, not
 * a tenant schema — so the request pipeline lets them pass through untouched.
 * Used by the web landing page to list/create/select/delete namespaces.
 */
@ApiTags('Namespaces')
@AccessArea({ view: 'workspace.view', change: 'workspace.settings' })
@Controller('namespaces')
export class NamespacesController {
  constructor(
    private readonly registry: NamespaceRegistryService,
    private readonly tenancy: TenancyService,
    @Inject(IDENTITY) private readonly identity: IdentityService,
  ) {}

  /**
   * These routes run outside any workspace, so the access guard only checked
   * tenant-wide capabilities.
   *
   * The guard already authenticated this request (registry routes pass through
   * it), so reuse its principal instead of verifying the token again:
   * `IdentityService.authenticate` returns the principal cached on the
   * request on repeat calls.
   */
  private principal(request: FastifyRequest): Promise<Principal> {
    return this.identity.authenticate(request.raw);
  }

  private async requireIn(
    request: FastifyRequest,
    namespaceId: string,
    ...needed: Capability[]
  ): Promise<void> {
    const principal = await this.principal(request);
    const capabilities = await this.identity.capabilitiesIn(
      principal,
      namespaceId,
    );
    if (!capabilities?.has('workspace.view')) {
      throw new NotFoundException(`Unknown namespace '${namespaceId}'`);
    }
    const missing = needed.find((capability) => !capabilities.has(capability));
    if (missing) throw new CapabilityRequiredException(missing);
  }

  private async tenantId(request: FastifyRequest): Promise<string> {
    return (await this.principal(request)).tenant.id;
  }

  /** A workspace can only be filed under its tenant's categories. */
  private async assertOwnCategories(
    request: FastifyRequest,
    categoryIds: string[] | undefined,
  ): Promise<void> {
    if (!categoryIds?.length) return;
    const tenantId = await this.tenantId(request);
    const own = new Set(
      (await this.registry.listCategories(tenantId)).map((c) => c.id),
    );
    const foreign = categoryIds.find((id) => !own.has(id));
    if (foreign) throw new NotFoundException(`Unknown category '${foreign}'`);
  }

  private async visibleIds(request: FastifyRequest): Promise<Set<string>> {
    const principal = await this.principal(request);
    return new Set((await this.identity.visibleWorkspaces(principal)).keys());
  }

  @Get()
  @ApiOperation({
    summary: 'List the namespaces the caller can see',
  })
  async list(
    @Req() request: FastifyRequest,
  ): Promise<(Namespace & { capabilities?: Capability[] })[]> {
    const principal = await this.principal(request);
    const [namespaces, visible] = await Promise.all([
      this.registry.list(),
      this.identity.visibleWorkspaces(principal),
    ]);
    // What the caller may do in each, so the directory offers only the
    // controls that will work (deleting, for instance).
    return namespaces.flatMap((ns) => {
      const capabilities = visible.get(ns.id);
      return capabilities
        ? [{ ...ns, capabilities: [...capabilities].sort() }]
        : [];
    });
  }

  @Requires('tenant.workspace.create')
  @Post()
  @ApiOperation({
    summary: 'Create a namespace (provisions its Postgres schema + migrations)',
    description:
      '`ownerGroupId` is required: a group of your tenant that you belong to and may create workspaces for (GET /namespaces/owning-groups).',
  })
  async create(
    @Req() request: FastifyRequest,
    @Body() body: CreateNamespaceInput,
  ): Promise<Namespace> {
    await this.assertOwnCategories(request, body.categoryIds);
    const principal = await this.principal(request);
    if (!body.ownerGroupId) {
      throw new BadRequestException(
        'ownerGroupId is required: every workspace is owned by one group of your tenant.',
      );
    }
    if (
      !(await this.identity.canCreateWorkspace(principal, body.ownerGroupId))
    ) {
      throw new CapabilityRequiredException('tenant.workspace.create');
    }
    const created = await this.registry.create(body, {
      tenantId: principal.tenant.id,
      ownerGroupId: body.ownerGroupId,
    });
    await this.tenancy.recordTenantEvent(
      principal.tenant.id,
      principal.actor.ref,
      'workspace.created',
      {
        namespaceId: created.id,
        slug: created.slug,
        ownerGroupId: body.ownerGroupId,
      },
    );
    return created;
  }

  @Get('owning-groups')
  @ApiOperation({
    summary: 'Groups the caller may create workspaces for',
  })
  async owningGroups(
    @Req() request: FastifyRequest,
  ): Promise<{ id: string; name: string; path: string }[]> {
    const principal = await this.principal(request);
    return (await this.identity.owningGroups(principal)).map(
      ({ id, name, path }) => ({ id, name, path }),
    );
  }

  @Get('stats')
  @ApiOperation({
    summary:
      'Per-namespace source rollups (total + failing + running + pending)',
  })
  async stats(@Req() request: FastifyRequest): Promise<NamespaceStats[]> {
    const [stats, visible] = await Promise.all([
      this.registry.stats(),
      this.visibleIds(request),
    ]);
    return stats.filter((row) => visible.has(row.id));
  }

  // Category routes are declared BEFORE `:id` so `/namespaces/categories` is
  // matched as itself and not as a namespace whose id is "categories".
  @Get('categories')
  @ApiOperation({ summary: 'List workspace categories with workspace counts' })
  async listCategories(
    @Req() request: FastifyRequest,
  ): Promise<NamespaceCategory[]> {
    return this.registry.listCategories(await this.tenantId(request));
  }

  @Requires('tenant.categories.manage')
  @Post('categories')
  @ApiOperation({ summary: 'Create a workspace category' })
  async createCategory(
    @Req() request: FastifyRequest,
    @Body() body: CreateNamespaceCategoryInput,
  ): Promise<NamespaceCategory> {
    return this.registry.createCategory(body, await this.tenantId(request));
  }

  @Requires('tenant.categories.manage')
  @Patch('categories/:categoryId')
  @ApiOperation({ summary: 'Rename or re-describe a workspace category' })
  async updateCategory(
    @Req() request: FastifyRequest,
    @Param('categoryId') categoryId: string,
    @Body() body: UpdateNamespaceCategoryInput,
  ): Promise<NamespaceCategory> {
    return this.registry.updateCategory(
      categoryId,
      body,
      await this.tenantId(request),
    );
  }

  @Requires('tenant.categories.manage')
  @Delete('categories/:categoryId')
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Delete a category (its workspaces fall back to the default category)',
  })
  async removeCategory(
    @Req() request: FastifyRequest,
    @Param('categoryId') categoryId: string,
  ): Promise<void> {
    await this.registry.removeCategory(
      categoryId,
      await this.tenantId(request),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a namespace by id' })
  async get(
    @Req() request: FastifyRequest,
    @Param('id') id: string,
  ): Promise<Namespace> {
    await this.requireIn(request, id, 'workspace.view');
    return this.registry.get(id);
  }

  @Get(':id/thumbnail')
  @ApiOperation({ summary: "Stream a namespace's thumbnail image" })
  async thumbnail(
    @Req() request: FastifyRequest,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.requireIn(request, id, 'workspace.view');
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
  async update(
    @Req() request: FastifyRequest,
    @Param('id') id: string,
    @Body() body: UpdateNamespaceInput,
  ): Promise<Namespace> {
    await this.requireIn(
      request,
      id,
      'workspace.settings',
      ...(body.paused !== undefined ? (['workspace.pause'] as const) : []),
    );
    await this.assertOwnCategories(request, body.categoryIds);
    return this.registry.update(id, body);
  }

  @Requires('workspace.delete')
  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Soft-delete a namespace (hidden from listings; data retained)',
  })
  async remove(
    @Req() request: FastifyRequest,
    @Param('id') id: string,
  ): Promise<void> {
    await this.requireIn(request, id, 'workspace.delete');
    await this.registry.remove(id);
    const principal = await this.principal(request);
    await this.tenancy.recordTenantEvent(
      principal.tenant.id,
      principal.actor.ref,
      'workspace.deleted',
      { namespaceId: id },
    );
  }
}
