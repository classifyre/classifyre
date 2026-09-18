import {
  NamespacePauseService,
  NamespacePausedException,
} from './namespace-pause.service';

describe('NamespacePauseService', () => {
  const build = (namespaceId: string | undefined, paused: boolean) => {
    const registry = { isPaused: jest.fn().mockResolvedValue(paused) };
    const cls = { get: jest.fn().mockReturnValue(namespaceId) };
    const service = new NamespacePauseService(registry as never, cls as never);
    return { service, registry };
  };

  it('reports not-paused outside any namespace without touching the registry', async () => {
    const { service, registry } = build(undefined, true);
    await expect(service.isPaused()).resolves.toBe(false);
    await expect(service.assertNotPaused()).resolves.toBeUndefined();
    expect(registry.isPaused).not.toHaveBeenCalled();
  });

  it('delegates to the registry inside a namespace', async () => {
    const { service } = build('n1', true);
    await expect(service.isPaused()).resolves.toBe(true);
    await expect(service.assertNotPaused()).rejects.toBeInstanceOf(
      NamespacePausedException,
    );
  });

  it('passes through when the workspace is running', async () => {
    const { service } = build('n1', false);
    await expect(service.assertNotPaused()).resolves.toBeUndefined();
  });
});
