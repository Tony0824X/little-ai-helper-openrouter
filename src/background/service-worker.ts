// Background service worker: the AI hub. It owns the provider, the API key, and
// the cross-origin fetch for document and page requests. The settings page also
// makes a synthetic connection-test request using the key currently being edited.
// It handles AI_* messages and replies with an AIResult ({ text } or { error }).

import { getProfile, profileToContext, type AISettings } from '../lib/profile';
import { getActiveJob } from '../lib/savedJobs';
import { getProvider, AIError, type AIProvider } from '../lib/ai';
import {
  buildAnswerPrompt,
  buildResumeParsePrompt,
} from '../lib/ai/prompts';
import type { AIResult, BackgroundMessage } from '../lib/messages';
import { buildFormPrompt, FORM_LIMIT, unsupportedHistory, missingPersonalFact, groundPersonalAnswers, parseFormPlan } from '../lib/formPlan';

type EnabledMessage = Extract<BackgroundMessage, { type: 'AI_GENERATE_ANSWER' | 'AI_PARSE_RESUME' | 'AI_FILL_FORM' }>;

// The same selected free OpenRouter model handles every AI operation.
async function resolveProvider(ai: AISettings): Promise<AIProvider> {
  return getProvider(ai);
}

chrome.runtime.onMessage.addListener((msg: BackgroundMessage, sender, sendResponse) => {
  // Only our own pages/content scripts may drive the AI hub. No
  // externally_connectable is declared, so this can't fire for web pages today —
  // the check makes that boundary explicit rather than implicit.
  if (sender.id !== chrome.runtime.id) return false;
  // Only handle our AI messages; ignore content-targeted ones.
  if (
    msg?.type !== 'AI_GENERATE_ANSWER' &&
    msg?.type !== 'AI_FILL_FORM' &&
    msg?.type !== 'AI_PARSE_RESUME'
  ) {
    return false;
  }
  handle(msg)
    .then((text) => sendResponse({ text } satisfies AIResult))
    .catch((e: unknown) =>
      sendResponse({
        text: '',
        error: e instanceof AIError ? e.message : `Unexpected error: ${(e as Error).message}`,
      } satisfies AIResult),
    );
  return true; // keep the message channel open for the async response
});

async function handle(msg: EnabledMessage): Promise<string> {
  const profile = await getProfile();
  const context = profileToContext(profile);

  if (msg.type === 'AI_FILL_FORM') {
    if (!context.trim()) throw new AIError('Upload a CV or add your profile in Settings first.');
    if (!Array.isArray(msg.fields) || !msg.fields.length || msg.fields.length > FORM_LIMIT || JSON.stringify(msg.fields).length > 500000) throw new AIError('This form is too large or invalid.');
    const provider = await resolveProvider(profile.ai);
    // Form filling always uses THIS page, not an unrelated active saved job.
    const preferences = [
      profile.preferences.workAuthorization && `Work authorisation: ${profile.preferences.workAuthorization}`,
      profile.preferences.requiresSponsorship && `Requires sponsorship: ${profile.preferences.requiresSponsorship}`,
      profile.preferences.salaryExpectation && `Expected salary: ${profile.preferences.salaryExpectation}`,
    ].filter(Boolean).join('\n');
    if (msg.document && (typeof msg.document.structure !== 'string' || msg.document.structure.length > 100000)) throw new AIError('Invalid form structure.');
    const fields = msg.fields.map(f => {
      const reason = unsupportedHistory(f, context) ? 'This personal history is not stated in the CV; answer manually.' : missingPersonalFact(f, context);
      return reason ? { ...f, blocked: f.blocked || reason } : f;
    });
    const requested = new Set(msg.targetIds || fields.map(f => f.id));
    const targets = fields.filter(f => requested.has(f.id) && !f.blocked && !f.hasValue && f.visible !== false);
    // Every call includes the complete loaded form, even during a repair pass.
    const raw = targets.length ? await provider.generate(buildFormPrompt(fields, `${context}\n${preferences}`, msg.jobText || '', msg.document, targets.map(f => f.id))) : '{"answers":[]}';
    const plan = groundPersonalAnswers(parseFormPlan(raw, targets), fields, context);
    return JSON.stringify({ answers: [...plan.answers, ...fields.filter(f => f.blocked && requested.has(f.id)).map(f => ({ id: f.id, value: '', reason: f.blocked }))] });
  }

  if (
    msg.type === 'AI_GENERATE_ANSWER' &&
      context.trim() === ''
  ) {
    throw new AIError('Your profile is empty — add your details in Options first.');
  }

  if (msg.type === 'AI_PARSE_RESUME') {
    // Returns raw JSON text; the options page validates it via parseResumeJson.
    const provider = await resolveProvider(profile.ai);
    return provider.generate(buildResumeParsePrompt(msg.text));
  }

  // The remaining handlers tailor to a job posting. A saved "active" job wins
  // over the live page's text/company/role, so tailoring survives a multi-page
  // application that has navigated away from the posting.
  const activeJob = await getActiveJob();
  const jobText = activeJob?.text || msg.jobText;

  const provider = await resolveProvider(profile.ai);
  return provider.generate({
    ...buildAnswerPrompt(msg.question, context, jobText),
    model: profile.ai.model,
  });
}

// Clicking the toolbar icon opens the side panel (which stays open until the
// user closes it), instead of a popup that closes on outside click.
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});

// Open the options page on first install so the user can set up their profile + key.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage().catch(() => {});
  }
});
