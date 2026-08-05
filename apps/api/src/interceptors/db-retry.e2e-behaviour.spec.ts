import { Controller, Get, Post } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client';
import { PrismaExceptionFilter } from '../filters/prisma-exception.filter';
import { ReadOnlyEndpoint } from '../db/read-only-endpoint.decorator';
import { DbRetryInterceptor } from './db-retry.interceptor';

const poolTimeout = () =>
  new PrismaClientKnownRequestError(
    'Transaction API error: Unable to start a transaction in the given time.',
    { code: 'P2028', clientVersion: '7.8.0' },
  );

/** Counts calls per route so a test can assert how often a handler ran. */
const calls = { flaky: 0, hopeless: 0, mutation: 0 };

@Controller('search')
@ReadOnlyEndpoint()
class TestSearchController {
  /** Fails once, then succeeds — the real-world pool-starvation blip. */
  @Get('flaky')
  flaky() {
    calls.flaky += 1;
    if (calls.flaky === 1) throw poolTimeout();
    return { ok: true, attempts: calls.flaky };
  }

  /** Never recovers: the client must end up with a retryable 503. */
  @Get('hopeless')
  hopeless() {
    calls.hopeless += 1;
    throw poolTimeout();
  }
}

@Controller()
class TestMutationController {
  @Post('sources')
  create() {
    calls.mutation += 1;
    throw poolTimeout();
  }
}

describe('transient database failures over HTTP', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TestSearchController, TestMutationController],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.useGlobalInterceptors(new DbRetryInterceptor(app.get(Reflector)));
    app.useGlobalFilters(new PrismaExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    calls.flaky = 0;
    calls.hopeless = 0;
    calls.mutation = 0;
  });

  it('hides a one-off P2028 from the client', async () => {
    const response = await app.inject({ method: 'GET', url: '/search/flaky' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, attempts: 2 });
  });

  it('answers a persistent failure with a retryable 503', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/search/hopeless',
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers['retry-after']).toBe('5');
    expect(response.json()).toMatchObject({ code: 'P2028' });
    expect(calls.hopeless).toBe(3);
  });

  it('never replays a mutation, but still reports it as retryable', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/sources',
      payload: {},
    });

    expect(response.statusCode).toBe(503);
    expect(calls.mutation).toBe(1);
  });
});
