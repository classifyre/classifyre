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
import { parseActorName, type Actor } from './actor';
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

  it('refuses a self-declared name that would pass as a typed reference', () => {
    expect(parseActorName('agent:autopilot')).toBeUndefined();
    expect(parseActorName('system:scheduler')).toBeUndefined();
    expect(parseActorName('Ops: night shift')).toBe('Ops: night shift');
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
    record: (event: AuditEventInput) => {
      recorded.push(event);
      return Promise.resolve();
    },
  } as unknown as AuditTrailService;
  const interceptor = new AuditInterceptor(new Reflector(), audit);
  const actor: Actor = {
    id: null,
    displayName: 'Jordan Reyes',
    kind: 'person',
    via: 'header',
    ref: 'Jordan Reyes',
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
