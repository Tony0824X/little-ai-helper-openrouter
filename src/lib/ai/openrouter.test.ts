import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenRouterProvider, OPENROUTER_ENDPOINT, OPENROUTER_TIMEOUT_MS } from './openrouter';
import { DEFAULT_OPENROUTER_MODEL, OPENROUTER_MODELS } from './openrouterModels';
import { DEFAULT_PROFILE } from '../profile';
import { getProvider } from './index';

const input = { system: 'Return only JSON.', prompt: 'Extract this synthetic resume.', json: true };
const key = 'synthetic-test-key';

function jsonResponse(text = '{"skills":["TypeScript"]}', finish = 'stop'): Response {
  return Response.json({ choices: [{ message: { content: text }, finish_reason: finish }] });
}

function streamed(events: unknown[], splitEveryByte = false, done = true): Response {
  const encoded = new TextEncoder().encode(': keep-alive\r\n\r\n' + events.map((e) => `data: ${JSON.stringify(e)}\r\n\r\n`).join('') + (done ? 'data: [DONE]\r\n\r\n' : ''));
  return new Response(new ReadableStream({
    start(controller) {
      if (splitEveryByte) for (const byte of encoded) controller.enqueue(new Uint8Array([byte]));
      else controller.enqueue(encoded);
      controller.close();
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('OpenRouter free-model integration', () => {
  it('uses Bearer auth, chat messages, JSON mode, streaming and a zero-price ceiling', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse());
    vi.stubGlobal('fetch', fetch);
    expect(await new OpenRouterProvider(` ${key} `).generate(input)).toBe('{"skills":["TypeScript"]}');
    const [url, request] = fetch.mock.calls[0];
    // A Unicode display-name dash in an HTTP header throws before fetch can
    // start in Chrome; exercise the native Request validation too.
    expect(() => new Request(url, request)).not.toThrow();
    expect(url).toBe(OPENROUTER_ENDPOINT);
    expect(url).not.toContain(key);
    expect(request.headers.Authorization).toBe(`Bearer ${key}`);
    expect(JSON.parse(request.body)).toMatchObject({
      model: DEFAULT_OPENROUTER_MODEL,
      messages: [{ role: 'system', content: input.system }, { role: 'user', content: input.prompt }],
      stream: true,
      response_format: { type: 'json_object' },
      reasoning: { enabled: false, exclude: true },
      provider: { require_parameters: true, max_price: { prompt: 0, completion: 0, request: 0 } },
    });
    expect(JSON.parse(request.body)).not.toHaveProperty('plugins');
  });

  it('uses the selected alternative for internal parsing as well as answer generation', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse());
    vi.stubGlobal('fetch', fetch);
    const provider = getProvider({ ...DEFAULT_PROFILE.ai, apiKey: key, model: OPENROUTER_MODELS[1].id });
    await provider.generate({ ...input, maxOutputTokens: 8192 });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ model: OPENROUTER_MODELS[1].id, max_tokens: 8192 });
  });

  it.each(['openai/gpt-4o', 'google/gemma-4-31b-it', 'unknown/model:free'])('blocks unapproved model %s before any network request', async (model) => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(new OpenRouterProvider(key).generate({ ...input, model })).rejects.toThrow('supported free');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not forward a legacy provider key', () => {
    expect(() => getProvider({ ...DEFAULT_PROFILE.ai, provider: 'gemini', apiKey: key })).toThrow('OpenRouter');
  });

  it('requires a key before making a request', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(new OpenRouterProvider(' ').generate(input)).rejects.toThrow('API key');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reassembles fragmented UTF-8 SSE with CRLF and ignores reasoning-only chunks', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamed([
      { choices: [{ delta: { reasoning: 'hidden thoughts' } }] },
      { choices: [{ delta: { content: '香港 ' } }] },
      { choices: [{ delta: { content: 'Engineer' }, finish_reason: 'stop' }] },
    ], true)));
    expect(await new OpenRouterProvider(key).generate(input)).toBe('香港 Engineer');
  });

  it('rejects a disconnected stream instead of importing partial data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamed([{ choices: [{ delta: { content: '{"personal":' } }] }], false, false)));
    await expect(new OpenRouterProvider(key).generate(input)).rejects.toThrow('connection ended');
  });

  it('discards partial text when the provider fails mid-stream', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamed([
      { choices: [{ delta: { content: 'Incomplete answer' } }] },
      { error: { code: 429, message: 'PRIVATE RESUME TEXT' }, choices: [{ finish_reason: 'error' }] },
    ])));
    await expect(new OpenRouterProvider(key).generate(input)).rejects.toThrow('rate limit');
  });

  it.each([401, 402, 403, 404, 429, 500, 503])('handles HTTP %s without leaking raw responses or retrying', async (status) => {
    const fetch = vi.fn().mockResolvedValue(new Response(`PRIVATE RESUME ${key}`, { status, headers: { 'Retry-After': '60' } }));
    vi.stubGlobal('fetch', fetch);
    try { await new OpenRouterProvider(key).generate(input); expect.fail('must reject'); }
    catch (e) {
      expect((e as Error).message).toContain(status === 404 || status === 503 ? 'free model' : 'OpenRouter');
      expect((e as Error).message).not.toContain('PRIVATE RESUME');
      expect((e as Error).message).not.toContain(key);
      if (status === 429) expect((e as Error).message).toContain('60 seconds');
    }
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(['length', 'content_filter', 'error'])('rejects finish reason %s', async (finish) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse('Some answer', finish)));
    await expect(new OpenRouterProvider(key).generate(input)).rejects.toThrow();
  });

  it.each([
    { limit_source: 'upstream_provider_shared_pool', raw: `PRIVATE RESUME ${key}` },
    { raw: `model is temporarily rate-limited upstream. PRIVATE RESUME ${key}` },
  ])('distinguishes provider shared-pool throttling from daily account quota', async (metadata) => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ error: { code: 429, message: 'Provider returned error', metadata } }, { status: 429 }));
    vi.stubGlobal('fetch', fetch);
    try { await new OpenRouterProvider(key).generate(input); expect.fail('must reject'); }
    catch (e) {
      expect((e as Error).message).toContain('provider shared pool is busy');
      expect((e as Error).message).toContain('does not mean your daily quota is exhausted');
      expect((e as Error).message).not.toContain(key);
      expect((e as Error).message).not.toContain('PRIVATE RESUME');
    }
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('explains that switching models does not bypass the account daily quota', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code: 429, message: 'Rate limit exceeded: free-models-per-day' } }, { status: 429 })));
    await expect(new OpenRouterProvider(key).generate(input)).rejects.toThrow('switching models does not reset it');
  });

  it('does not guess the cause of an unclassified rate limit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code: 429, metadata: { raw: { unexpected: key } } } }, { status: 429 })));
    await expect(new OpenRouterProvider(key).generate(input)).rejects.toThrow('OpenRouter or the model provider returned a rate limit');
  });

  it('classifies provider throttling received inside a stream', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamed([{ error: { code: 429, metadata: { limit_source: 'upstream_provider_shared_pool' } } }])));
    await expect(new OpenRouterProvider(key).generate(input)).rejects.toThrow('provider shared pool is busy');
  });

  it('handles an error inside an HTTP 200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code: 429 } })));
    await expect(new OpenRouterProvider(key).generate(input)).rejects.toThrow('rate limit');
  });

  it('rejects empty answers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse('  ')));
    await expect(new OpenRouterProvider(key).generate(input)).rejects.toThrow('no answer');
  });

  it('aborts a stalled request with an actionable timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));
    const assertion = expect(new OpenRouterProvider(key).generate(input)).rejects.toThrow('too long');
    await vi.advanceTimersByTimeAsync(OPENROUTER_TIMEOUT_MS);
    await assertion;
  });
});
