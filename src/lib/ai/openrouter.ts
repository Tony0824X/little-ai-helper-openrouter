import { AIError, type AIProvider, type GenerateInput } from './provider';
import { DEFAULT_OPENROUTER_MODEL, isOpenRouterModel } from './openrouterModels';

export const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
export const OPENROUTER_TIMEOUT_MS = 90_000;

interface OpenRouterError {
  code?: number;
  message?: string;
  metadata?: { limit_source?: string; raw?: unknown };
}

interface Completion {
  error?: OpenRouterError;
  choices?: Array<{
    delta?: { content?: string | null };
    message?: { content?: string | null; refusal?: string | null };
    finish_reason?: string | null;
  }>;
}

function requestError(status: number, retryAfter?: string | null, error?: OpenRouterError): AIError {
  if (status === 401) return new AIError('OpenRouter API key is invalid or expired. Update it in Settings.');
  if (status === 402) return new AIError('OpenRouter rejected this key/account limit. Check your account at openrouter.ai/settings/keys. This extension only requests free models.');
  if (status === 403) return new AIError('OpenRouter denied this request. Check the key permissions, account privacy settings, and model availability in your region.');
  if (status === 429) {
    const wait = retryAfter && /^\d+$/.test(retryAfter) ? ` Wait at least ${retryAfter} seconds.` : '';
    // Classify known signals, but never display raw errors: providers may echo
    // credentials or resume text in their response body.
    const raw = typeof error?.metadata?.raw === 'string' ? error.metadata.raw : '';
    const message = typeof error?.message === 'string' ? error.message : '';
    if (error?.metadata?.limit_source === 'upstream_provider_shared_pool' || /temporarily rate-limited upstream/i.test(raw)) {
      return new AIError(`OpenRouter: the free model's provider shared pool is busy (upstream rate limit). This does not mean your daily quota is exhausted. Select another free model in Settings or retry later.${wait}`);
    }
    if (/free-models-per-day|free requests per day|daily (?:free[- ]model )?(?:request )?(?:limit|quota)/i.test(`${message} ${raw}`)) {
      return new AIError(`OpenRouter daily free-request quota reached. Wait for the daily quota to reset; switching models does not reset it.${wait}`);
    }
    return new AIError(`OpenRouter or the model provider returned a rate limit. Check your free-request quota, or select another free model and retry later.${wait}`);
  }
  if (status === 404 || status === 503) return new AIError('This free model currently has no available endpoint. Choose the other free model in Settings or retry later.');
  if (status === 400) return new AIError('OpenRouter could not accept this request. Try a shorter document or the other free model.');
  return new AIError(`OpenRouter request failed (${status || 'provider error'}). Retry later. No paid model was requested.`);
}

function completedText(text: string, finish: string | null | undefined): string {
  if (finish === 'length') throw new AIError('The AI response was cut off. Use a shorter document or question and try again. Nothing was imported from this incomplete response.');
  if (finish === 'content_filter') throw new AIError('The AI provider declined this content. Review the document or question and try again.');
  if (finish === 'error') throw requestError(502);
  if (!text.trim()) throw new AIError('OpenRouter returned no answer. Retry or choose the other free model.');
  return text.trim();
}

/** Streaming sends headers early and avoids a long silent fetch in MV3 workers.
 * Never return partial text after an interrupted stream or provider error.
 */
async function readCompletion(res: Response): Promise<string> {
  if (!res.headers.get('content-type')?.includes('text/event-stream')) {
    const data = await res.json() as Completion;
    if (data.error) throw requestError(data.error.code ?? 502, null, data.error);
    const choice = data.choices?.[0];
    if (choice?.message?.refusal) throw new AIError('The AI provider declined this request.');
    return completedText(choice?.message?.content ?? '', choice?.finish_reason);
  }
  if (!res.body) throw new AIError('OpenRouter returned an empty stream. Please retry.');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let finish: string | null | undefined;
  let doneEvent = false;
  let bytes = 0;

  function readEvent(event: string): void {
    const payload = event.split('\n').filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart()).join('\n').trim();
    if (!payload) return; // SSE comments / keep-alive events.
    if (payload === '[DONE]') { doneEvent = true; return; }
    const data = JSON.parse(payload) as Completion;
    if (data.error) throw requestError(data.error.code ?? 502, null, data.error);
    const choice = data.choices?.[0];
    if (typeof choice?.delta?.content === 'string') text += choice.delta.content;
    if (choice?.finish_reason) finish = choice.finish_reason;
    if (finish === 'error') throw requestError(502);
  }

  try {
    while (!doneEvent) {
      const chunk = await reader.read();
      if (chunk.done) { buffer += decoder.decode(); break; }
      bytes += chunk.value.byteLength;
      if (bytes > 2_000_000) throw new AIError('The AI response was unexpectedly large. Please retry with less context.');
      buffer += decoder.decode(chunk.value, { stream: true });
      // Normalize after appending so CR/LF split across network chunks works.
      buffer = buffer.replace(/\r\n/g, '\n');
      let end: number;
      while ((end = buffer.indexOf('\n\n')) !== -1 && !doneEvent) {
        readEvent(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
      }
    }
    if (!doneEvent && buffer.trim()) readEvent(buffer);
    if (!doneEvent && !finish) throw new AIError('The connection ended before the AI finished. Please retry; the partial answer was discarded.');
    return completedText(text, finish);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export class OpenRouterProvider implements AIProvider {
  readonly id = 'openrouter';

  constructor(private apiKey: string, private model: string = DEFAULT_OPENROUTER_MODEL) {}

  async generate({ system, prompt, maxOutputTokens, json, thinking, model }: GenerateInput): Promise<string> {
    const key = this.apiKey.trim();
    if (!key) throw new AIError('Add your OpenRouter API key in Settings first.');
    const modelId = model || this.model;
    if (!isOpenRouterModel(modelId)) throw new AIError('Choose one of the supported free OpenRouter models in Settings.');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);
    try {
      const res = await fetch(OPENROUTER_ENDPOINT, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'X-OpenRouter-Title': 'Little AI Helper - OpenRouter Free',
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
          stream: true,
          temperature: json ? 0.1 : 0.5,
          max_tokens: maxOutputTokens ?? 2048,
          reasoning: { enabled: thinking === true, exclude: true },
          ...(json ? { response_format: { type: 'json_object' } } : {}),
          // Never route to a paid endpoint, even if the catalogue changes.
          // No web/PDF plugins: PDF text is extracted locally with pdf.js.
          provider: {
            allow_fallbacks: true,
            require_parameters: true,
            max_price: { prompt: 0, completion: 0, request: 0 },
          },
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as Completion | null;
        throw requestError(res.status, res.headers.get('retry-after'), data?.error);
      }
      return await readCompletion(res);
    } catch (error) {
      if (error instanceof AIError) throw error;
      if (controller.signal.aborted) throw new AIError('OpenRouter took too long to respond. Retry or choose the other free model.');
      // Do not echo raw provider responses or network details: they may contain
      // document text or credentials. Errors remain useful without those values.
      throw new AIError('Could not read a complete response from OpenRouter. Check your connection and retry.');
    } finally {
      clearTimeout(timeout);
    }
  }
}
