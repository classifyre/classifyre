import { AiAuthError } from '../ai';
import { AiProviderConfigController } from './ai-provider-config.controller';

function buildController(completeText: jest.Mock) {
  return new AiProviderConfigController(
    {
      get: jest.fn().mockResolvedValue({
        id: 'cfg-1',
        name: 'Harness Claude',
        provider: 'CLAUDE',
        model: 'claude-sonnet-4-5',
      }),
    } as never,
    { completeText } as never,
    {} as never,
  );
}

describe('AiProviderConfigController connection diagnostics', () => {
  it('explains a successful live request', async () => {
    const controller = buildController(
      jest.fn().mockResolvedValue({
        provider: 'CLAUDE',
        model: 'claude-sonnet-4-5',
        content: '  {"status":"ok"}\n',
        usage: { inputTokens: 12, outputTokens: 7 },
      }),
    );

    const result = await controller.test('cfg-1');

    expect(result).toMatchObject({
      status: 'PASS',
      category: 'CONNECTION',
      provider: 'CLAUDE',
      model: 'claude-sonnet-4-5',
      inputTokens: 12,
      outputTokens: 7,
      responsePreview: '{"status":"ok"}',
    });
    expect(result.message).toContain('connected successfully');
    expect(result.details).toContain(
      'The provider accepted a real completion request.',
    );
  });

  it('returns actionable authentication failure details without hiding why', async () => {
    const controller = buildController(
      jest.fn().mockRejectedValue(new AiAuthError('API key was rejected')),
    );

    const result = await controller.test('cfg-1');

    expect(result).toMatchObject({
      status: 'FAIL',
      category: 'AUTHENTICATION',
      message: 'API key was rejected',
      inputTokens: null,
      outputTokens: null,
      responsePreview: null,
    });
    expect(result.details.join(' ')).toContain('Replace the API key');
  });
});
