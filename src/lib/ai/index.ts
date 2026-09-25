import type { AISettings } from '../profile';
import { AIError, type AIProvider } from './provider';
import { OpenRouterProvider } from './openrouter';

export { AIError } from './provider';
export type { AIProvider, GenerateInput } from './provider';

/** Every AI task uses the selected free model, including PDF resume parsing. */
export function getProvider(settings: AISettings): AIProvider {
  if (settings.provider !== 'openrouter') {
    throw new AIError('Select OpenRouter and add your OpenRouter key in Settings.');
  }
  return new OpenRouterProvider(settings.apiKey, settings.model);
}
