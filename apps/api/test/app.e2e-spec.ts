import request from 'supertest';
import { createTestApp, TestApp } from './create-test-app';

describe('AppController (e2e)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('/ (GET) should return health check', () => {
    return request(ctx.httpTarget)
      .get('/')
      .expect(200)
      .expect((res) => {
        expect(res.body).toHaveProperty('status', 'ok');
        expect(res.body).toHaveProperty('service', 'Classifyre API');
        expect(res.body).toHaveProperty('version');
        expect(res.body).toHaveProperty('timestamp');
      });
  });
});
