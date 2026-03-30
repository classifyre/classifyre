import type { AiProviderType, IAiProvider } from '../types';
import { ClaudeProvider } from './claude.provider';
import { GeminiProvider } from './gemini.provider';
import { OpenAiProvider } from './openai.provider';

export { ClaudeProvider } from './claude.provider';
export { GeminiProvider } from './gemini.provider';
export { OpenAiProvider } from './openai.provider';

export function createProvider(providerType: AiProviderType): IAiProvider {
  switch (providerType) {
    case 'CLAUDE':
      return new ClaudeProvider();
    case 'GEMINI':
      return new GeminiProvider();
    case 'OPENAI_COMPATIBLE':
      return new OpenAiProvider();
  }
}
