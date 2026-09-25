// Verified against OpenRouter's public model catalogue on 2026-09-25.
// Deliberately curated: every choice has a :free route and JSON output support.
export const OPENROUTER_MODELS = [
  { id: 'dots-studio/dots-3-note-preview:free', label: 'Dots3-Note Preview — free · recommended' },
  { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B — free · alternative' },
  { id: 'google/gemma-4-26b-a4b-it:free', label: 'Gemma 4 26B A4B — free · lightweight alternative' },
] as const;

export const DEFAULT_OPENROUTER_MODEL = OPENROUTER_MODELS[0].id;

export function isOpenRouterModel(id: string): boolean {
  return OPENROUTER_MODELS.some((model) => model.id === id);
}
