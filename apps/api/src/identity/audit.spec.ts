import 'reflect-metadata';
import {
  Controller,
  Get,
  Patch,
  Post,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { InternalOnly } from '../internal-only.decorator';
import { AccessArea, Requires } from './access.decorators';
import type { Actor } from './actor';
import { parseActorRef } from './actor-ref';
import { AuditInterceptor, routeEntity } from './audit.interceptor';
import type { AuditEventInput, AuditTrailService } from './audit-trail.service';
import { mcpToolEntity } from './mcp-tool-capabilities';

describe('actor references', () => {
  it.each([
    [
      'mcp:2c7b9260-cc88-45f8-9459-defe4a662708',
      { kind: 'mcp', id: '2c7b9260-cc88-45f8-9459-defe4a662708' },
    ],
    ['agent:autopilot', { kind: 'agent', id: 'autopilot' }],
    ['system:runner', { kind: 'system', id: 'runner' }],
    [
      'user:9f2c@mcp:41ab-77',
      { kind: 'user', id: '9f2c', via: { kind: 'mcp', id: '41ab-77' } },
    ],
    ['Jordan Reyes', { kind: 'name', id: 'Jordan Reyes' }],
    ['Reyes, Jordan', { kind: 'name', id: 'Reyes, Jordan' }],
    ['note: urgent', { kind: 'name', id: 'note: urgent' }],
  ])('parses %s', (ref, expected) => {
    expect(parseActorRef(ref)).toEqual(expected);
  });
});

describe('routeEntity', () => {
  it('names the resource up to the first parameter', () => {
    expect(
      routeEntity(
        '/cases/:id/evidence/:evidenceId',
        { id: 'c1', evidenceId: 'e1' },
        {},
      ),
    ).toEqual({ entityType: 'cases', entityId: 'c1' });
    expect(routeEntity('/glossary/schemes/:id', { id: 's1' }, {})).toEqual({
      entityType: 'glossary/schemes',
      entityId: 's1',
    });
  });

  it('takes the id of a created object from the response', () => {
    expect(routeEntity('/sources', {}, { id: 'src-1', name: 'x' })).toEqual({
      entityType: 'sources',
      entityId: 'src-1',
    });
    expect(routeEntity('/findings/bulk-update', {}, { updated: 3 })).toEqual({
      entityType: 'findings/bulk-update',
      entityId: null,
    });
  });

  it('files access grants under the workspace, not access/grants', () => {
    expect(
      routeEntity('/access/grants', {}, { id: 'g-1', scopeId: 'ws-1' }, 'ws-1'),
    ).toEqual({ entityType: 'workspaces', entityId: 'g-1' });
    expect(
      routeEntity('/access/grants/:id', { id: 'g-1' }, {}, 'ws-1'),
    ).toEqual({ entityType: 'workspaces', entityId: 'g-1' });
  });

  it('names a grant change "<group> on <scope>" when the response says so', () => {
    expect(
      routeEntity(
        '/access/grants',
        {},
        {
          id: 'g-1',
          subjectLabel: '/finance',
          scopeLabel: 'shop_lake.shop.orders',
        },
        'ws-1',
      ),
    ).toEqual({
      entityType: 'workspaces',
      entityId: 'g-1',
      entityName: '/finance on shop_lake.shop.orders',
    });
  });

  it('tags data grants with what they open, given or removed', () => {
    const tableGrant = {
      id: 'g-2',
      roleKey: 'data-reader',
      scopeType: 'asset',
      scopeId: 'ws-1/a-orders',
      sourceId: 's-shop',
      subjectLabel: '/finance',
      scopeLabel: 'orders',
    };
    // Given: the table, its source (for the source's Activity) and `data`.
    expect(routeEntity('/access/grants', {}, tableGrant, 'ws-1')).toMatchObject(
      {
        entityId: 'g-2',
        resources: ['data', 'asset:a-orders', 'source:s-shop'],
      },
    );
    // Removed: the response is the removed grant, so it is tagged alike.
    expect(
      routeEntity(
        '/access/grants/:id',
        { id: 'g-3' },
        {
          id: 'g-3',
          roleKey: 'data-reader',
          scopeType: 'source',
          scopeId: 'ws-1/s-shop',
          subjectLabel: '/finance',
          scopeLabel: 'Shop',
        },
        'ws-1',
      ),
    ).toMatchObject({
      entityName: '/finance on Shop',
      resources: ['data', 'source:s-shop'],
    });
    // Not data access: no tags, nothing for a Data tab to show.
    expect(
      routeEntity(
        '/access/grants',
        {},
        {
          id: 'g-4',
          roleKey: 'viewer',
          scopeType: 'workspace',
          scopeId: 'ws-1',
        },
        'ws-1',
      ),
    ).not.toHaveProperty('resources');
  });

  it('files notification audience changes under the workspace', () => {
    expect(
      routeEntity(
        '/notifications/audiences/:type',
        { type: 'SCAN' },
        {},
        'ws-1',
      ),
    ).toEqual({ entityType: 'workspaces', entityId: 'SCAN' });
  });
});

describe('mcpToolEntity', () => {
  it('files a tool call under the same entity as its REST twin', () => {
    expect(mcpToolEntity('update_case', { id: 'c1', title: 't' })).toEqual({
      entityType: 'cases',
      entityId: 'c1',
    });
    expect(mcpToolEntity('add_case_evidence', { caseId: 'c2' })).toEqual({
      entityType: 'cases',
      entityId: 'c2',
    });
    expect(mcpToolEntity('unknown_tool', {})).toEqual({
      entityType: null,
      entityId: null,
    });
  });
});

@AccessArea({ view: 'source.view', change: 'source.manage' })
@Controller('sources')
class SampleController {
  @Get(':id')
  get() {}

  @Patch(':id')
  update() {}

  @Requires('source.view')
  @Post('preview')
  preview() {}

  @InternalOnly()
  @Post(':id/assets')
  ingest() {}
}

describe('AuditInterceptor', () => {
  const recorded: AuditEventInput[] = [];
  const audit = {
    inWorkspace: () => true,
    workspaceId: () => 'ws-1',
    record: (event: AuditEventInput) => {
      recorded.push(event);
      return Promise.resolve();
    },
  } as unknown as AuditTrailService;
  const interceptor = new AuditInterceptor(new Reflector(), audit);
  const actor: Actor = {
    id: 'user:u1',
    displayName: 'Jordan Reyes',
    kind: 'person',
    via: 'oidc',
    ref: 'user:u1',
  };

  async function call(
    handler: keyof SampleController,
    method: string,
    url: string,
  ) {
    const request = {
      method,
      body: { name: 'new name', config: { secret: 'never stored' } },
      params: { id: 's1' },
      routeOptions: { url },
      classifyreActor: actor,
    };
    const context = {
      getType: () => 'http',
      getHandler: () => SampleController.prototype[handler],
      getClass: () => SampleController,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    await lastValueFrom(
      interceptor.intercept(context, { handle: () => of({ ok: true }) }),
    );
  }

  beforeEach(() => {
    recorded.length = 0;
  });

  it('records a change with its actor and field names only', async () => {
    await call('update', 'PATCH', '/sources/:id');
    expect(recorded).toEqual([
      {
        actor,
        channel: 'rest',
        capability: 'source.manage',
        operation: 'PATCH /sources/:id',
        entityType: 'sources',
        entityId: 's1',
        fields: ['config', 'name'],
        status: 200,
      },
    ]);
    expect(JSON.stringify(recorded)).not.toContain('never stored');
  });

  it('skips reads, view-capability POSTs and internal callbacks', async () => {
    await call('get', 'GET', '/sources/:id');
    await call('preview', 'POST', '/sources/preview');
    await call('ingest', 'POST', '/sources/:id/assets');
    expect(recorded).toEqual([]);
  });
});
