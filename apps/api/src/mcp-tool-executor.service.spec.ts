import { AsyncLocalStorage } from 'node:async_hooks';
import { ClsService } from 'nestjs-cls';
import { McpToolExecutorService } from './mcp-tool-executor.service';
import { DemoModeService } from './demo-mode.service';
import { DemoModeException } from './demo-mode.exception';
import { CLS_DEMO_MODE_BYPASS } from './namespace/namespace.constants';

describe('McpToolExecutorService.assertNotDemoMode', () => {
  const cls = new ClsService(new AsyncLocalStorage());
  const executor = new McpToolExecutorService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { isDemoMode: true } as DemoModeService,
    cls,
  );

  it('blocks MCP writes on a demo instance', () => {
    cls.run(() => {
      expect(() => executor.assertNotDemoMode()).toThrow(DemoModeException);
    });
  });

  it('lets an MCP request that carried the bypass key write', () => {
    cls.run(() => {
      cls.set(CLS_DEMO_MODE_BYPASS, true);
      expect(() => executor.assertNotDemoMode()).not.toThrow();
    });
  });

  it('still blocks when called outside any request context', () => {
    expect(() => executor.assertNotDemoMode()).toThrow(DemoModeException);
  });
});
