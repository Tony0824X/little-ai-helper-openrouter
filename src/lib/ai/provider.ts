// Shared provider contract. This fork routes every AI feature to OpenRouter.

export interface GenerateInput {
  /** High-level instruction / persona for the model. */
  system: string;
  /** The concrete task + context (profile, question, etc.). */
  prompt: string;
  /** Optional output budget (e.g. resume parsing needs more than a short answer). */
  maxOutputTokens?: number;
  /** Request strict JSON output (sets the model's JSON response mode). */
  json?: boolean;
  /** Allow the model to "think" before answering (better quality, slower). */
  thinking?: boolean;
  /**
   * Optional per-request model override. Omitted, OpenRouter uses the selected
   * settings model. Overrides must also belong to the curated free-model list.
   */
  model?: string;
}

export interface AIProvider {
  readonly id: string;
  generate(input: GenerateInput): Promise<string>;
}

export class AIError extends Error {}
