// Content script: detects the ATS, fills standard fields on demand, and injects
// an "✨ AI answer" button beside each open-ended question.

// Read profile data only when the user requests a fill.
import { captureFields } from './formFields';
import { runAiFill, fillStatus, cancelFill } from './aiFill';
import { getSavedJobs, onSavedJobsChanged } from '../lib/savedJobs';
import { hostMatches } from '../lib/host';
import {
  findOpenQuestions,
  fillInput,
  needsReplaceConfirm,
  type OpenQuestion,
} from './adapters/shared';
import { greenhouseAdapter } from './adapters/greenhouse';
import { leverAdapter } from './adapters/lever';
import { workdayAdapter } from './adapters/workday';
import { ashbyAdapter } from './adapters/ashby';
import { cafedecoralAdapter } from './adapters/cafedecoral';
import type { SiteAdapter } from './adapters/types';
import { AI_BUTTON_CSS, BUTTON_CLASS } from './aiButtonStyles';
import { INLINE_ANSWER_ERROR_MAX, clearButtonError, showButtonError } from './buttonError';
import {
  CONTEXT_LOST_MESSAGE,
  isContextInvalidated,
  pageMessageRole,
  sendToBackground,
  UNSUPPORTED_REPLY_DELAY_MS,
} from '../lib/messages';
import type { AIResult, CapturedJob, ContentMessage, PageInfo } from '../lib/messages';
import {
  getScanText,
  captureJobWhenReady,
} from './sponsorship';

const ADAPTERS: SiteAdapter[] = [greenhouseAdapter, leverAdapter, workdayAdapter, ashbyAdapter, cafedecoralAdapter];
const adapter = ADAPTERS.find((a) => a.matches(new URL(location.href))) ?? null;

const BUTTON_LABEL = '✨ AI answer';
const CONFIRM_LABEL = '↻ Replace your text?';
const CONFIRM_WINDOW_MS = 4000;

// Buttons awaiting a confirming second click → the timer that disarms them.
// Keyed weakly so a button dropped by injectQuestionButtons' reconciliation
// takes its armed state with it.
const armedButtons = new WeakMap<HTMLButtonElement, number>();

// Buttons WE created. Reconciliation and cleanup only ever touch members of this
// set, so a host page element that happens to share our class can never mark a
// question as handled or get deleted by us. A WeakSet (not a DOM attribute) means
// the host can't forge membership by copying an attribute.
const ownedButtons = new WeakSet<HTMLButtonElement>();

// --- Messaging from popup ---
const isTopFrame = window.top === window.self;

// "Save this job" must read the frame that actually holds the posting. On some
// SPA / prerendered LinkedIn views the visible job renders in a SUB-FRAME, not the
// top document, so a top-frame-only capture reads an empty page. So CAPTURE_JOB is
// answered by the top frame AND any job-board sub-frame: empty frames poll the full
// timeout and reply last, so whichever frame really holds the posting wins the
// sendMessage race. Ad / tracker sub-frames are excluded by host so they can't
// answer with their own body text. PAGE_INFO / PAGE_FILL use a different rule —
// see pageMessageRole.
const JOB_HOSTS = [
  'linkedin.com', 'joinhandshake.com', 'greenhouse.io', 'lever.co',
  'myworkdayjobs.com', 'myworkday.com', 'myworkdaysite.com', 'ashbyhq.com', 'ycombinator.com',
];
const answersCapture = isTopFrame || JOB_HOSTS.some((h) => hostMatches(location.hostname, h));

chrome.runtime.onMessage.addListener((msg: ContentMessage, _sender, sendResponse) => {
  if (msg.type === 'CAPTURE_JOB') {
    if (!answersCapture) return false;
    // Async: also waits a beat for SPA detail panes to paint before snapshotting.
    captureJobWhenReady().then(({ company, role, text }) => {
      const captured: CapturedJob = { company, role, text, url: location.href, title: document.title };
      sendResponse(captured);
    });
    return true;
  }
  // PAGE_INFO / PAGE_FILL are answered by whichever frame an adapter matched —
  // the top frame normally, or the ATS's own iframe when a company careers site
  // embeds the application form. See pageMessageRole for the race it resolves.
  const genericForm = isTopFrame && captureFields().filter(b => !b.field.blocked).length >= 2;
  const hasForm = adapter !== null || genericForm;
  const role = pageMessageRole(hasForm, isTopFrame);
  if (role === 'ignore') return false;

  if (msg.type === 'PAGE_INFO') {
    if (!hasForm) {
      // role === 'answer-late': concede "unsupported" only after giving an
      // adapter-matching sub-frame time to answer first.
      setTimeout(
        () =>
          sendResponse({
            supported: false,
            site: null,
            company: '',
            role: '',
            jobText: '',
            // role === 'answer-late' only happens when isTopFrame (see
            // pageMessageRole), so this is always the real page hostname.
            hostname: location.hostname,
          } satisfies PageInfo),
        UNSUPPORTED_REPLY_DELAY_MS,
      );
      return true;
    }
    sendResponse({
      supported: true,
      site: adapter?.id || 'form',
      ...(adapter?.getPageInfo() || { company: location.hostname, role: document.title }),
      jobText: getScanText(),
      // Unlike the branch above, an adapter can match in a SUB-frame (embedded
      // ATS) — see the PageInfo docblock for why that frame's own hostname must
      // not be reported as the page's.
      hostname: isTopFrame ? location.hostname : '',
    } satisfies PageInfo);
    return false;
  }
  if (msg.type === 'PAGE_FILL') {
    // Only the adapter's own frame fills. The popup disables Fill unless some
    // frame reported supported, so an adapter-less frame acting here could only
    // ever be the wrong one — a careers page filling its own newsletter signup
    // while the real form sits in the iframe. Restricting it to one frame also
    // means there are no per-frame summaries to merge.
    if (!hasForm) return false;
    runAiFill(msg.requestId).then(sendResponse).catch(e => sendResponse({ error: (e as Error).message }));
    return true;
  }
  if (msg.type === 'PAGE_FILL_STATUS' && hasForm) { sendResponse(fillStatus()); return false; }
  if (msg.type === 'PAGE_FILL_CANCEL' && hasForm) { cancelFill(); sendResponse({ ok: true }); return false; }
  return false;
});

// The side panel may have probed before this module finished importing.
// Signal readiness without sending profile data or making an AI request.
if (isTopFrame || adapter) void chrome.runtime.sendMessage({ type: 'PAGE_READY' }).catch(() => {});

// --- AI answer buttons ---
// Reconcile the page to exactly one button per open question.
// We do NOT mark the textarea (an attribute or node identity the host framework
// would strip on re-render): Oracle/Workday-style forms re-render the field
// continuously, which previously made every observer cycle append another button
// while the old ones orphaned — a runaway pile-up. Keying on structure instead
// (which question a button belongs to) is churn-proof: strays are removed, gaps
// are filled, and the count can't exceed the number of current questions.
function injectQuestionButtons(): void {
  // Suspend the observer so our own DOM writes below don't re-trigger this pass.
  const wasObserving = questionsOn;
  if (wasObserving) observer.disconnect();

  const questions = findOpenQuestions();
  const wanted = new Set<Element>(questions.map((q) => q.el));

  // Group OUR buttons by the open question they belong to: the NEAREST wanted
  // question that precedes the button among its OWN siblings (not necessarily
  // the immediate previous sibling). A strict immediate-sibling check broke the
  // instant a host framework inserted anything else between a question and its
  // button — a live character counter re-rendered on every keystroke, on a
  // page like Oracle Cloud Recruiting, was enough: the button's
  // previousElementSibling became the counter instead of the textarea, so it
  // read as a stray and got removed while a fresh button was added right after
  // the textarea, both firing again on the very next keystroke — exactly the
  // one-button-per-character pile-up this function exists to prevent. Walking
  // back past intervening siblings survives that, since it stops only at
  // another wanted question (this button belongs to whichever wanted question
  // sits closest before it, wherever it ended up) or another owned button
  // (whose own walk already claims everything before it).
  const byQuestion = new Map<Element, HTMLButtonElement[]>();
  for (const btn of document.querySelectorAll<HTMLButtonElement>(`.${BUTTON_CLASS}`)) {
    if (!ownedButtons.has(btn)) continue; // ignore host elements sharing the class
    let owner: Element | null = null;
    for (let sib = btn.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (wanted.has(sib)) {
        owner = sib;
        break;
      }
      if (sib instanceof HTMLButtonElement && ownedButtons.has(sib)) break;
    }
    if (owner) {
      (byQuestion.get(owner) ?? byQuestion.set(owner, []).get(owner)!).push(btn);
    } else {
      btn.remove();
    }
  }

  // Keep exactly one button per question, preferring an in-flight one (disabled
  // while its answer generates) so a pending fill still targets a live node.
  const credited = new Set<Element>();
  for (const [el, btns] of byQuestion) {
    const keep = btns.find((b) => b.disabled) ?? btns[0];
    for (const b of btns) if (b !== keep) b.remove();
    credited.add(el);
  }

  // Add a button for any open question that doesn't already have one after it.
  for (const q of questions) {
    if (!credited.has(q.el)) addButtonFor(q);
  }

  if (wasObserving) observer.observe(document.body, { childList: true, subtree: true });
}

function addButtonFor(q: OpenQuestion): void {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = BUTTON_CLASS;
  btn.textContent = BUTTON_LABEL;
  ownedButtons.add(btn);
  btn.addEventListener('click', () => generateAnswer(q, btn));

  // Place the button right after the textarea.
  q.el.insertAdjacentElement('afterend', btn);
}

function disarm(btn: HTMLButtonElement): void {
  const timer = armedButtons.get(btn);
  if (timer !== undefined) window.clearTimeout(timer);
  armedButtons.delete(btn);
}

async function generateAnswer(q: OpenQuestion, btn: HTMLButtonElement): Promise<void> {
  clearButtonError(btn);
  // Replacing text the applicant already has is destructive and unrecoverable,
  // so it takes two clicks. Regeneration stays available — it just has to be
  // deliberate.
  if (needsReplaceConfirm(q.el.value, armedButtons.has(btn))) {
    btn.textContent = CONFIRM_LABEL;
    armedButtons.set(
      btn,
      window.setTimeout(() => {
        armedButtons.delete(btn);
        btn.textContent = BUTTON_LABEL;
      }, CONFIRM_WINDOW_MS),
    );
    return;
  }
  disarm(btn);

  // Revert to the constant, not to whatever the button happened to read on
  // entry — that could be the confirm prompt or a leftover transient state.
  const original = BUTTON_LABEL;
  btn.disabled = true;
  btn.textContent = '… thinking';
  try {
    const question = q.label || 'Please answer this application question.';
    const jobText = getScanText();
    const res = await sendToBackground<AIResult>({ type: 'AI_GENERATE_ANSWER', question, jobText });
    if (res.error) {
      showButtonError(btn, res.error, original, INLINE_ANSWER_ERROR_MAX);
    } else {
      fillInput(q.el, res.text);
      btn.textContent = '✓ filled';
      setTimeout(() => (btn.textContent = original), 2000);
    }
  } catch (e) {
    // A stale content script (extension reloaded/updated under an open tab) is
    // recoverable by refreshing, so say that rather than a bare "failed".
    const message = isContextInvalidated(e)
      ? CONTEXT_LOST_MESSAGE
      : e instanceof Error ? e.message : String(e);
    showButtonError(btn, message, original, INLINE_ANSWER_ERROR_MAX, 3000);
    console.error('[JobAutofill] answer generation failed', e);
  } finally {
    btn.disabled = false;
  }
}

// Application forms often render after a click, so watch for new questions.
let pending = 0;
const observer = new MutationObserver(() => {
  window.clearTimeout(pending);
  pending = window.setTimeout(injectQuestionButtons, 400);
});

function injectStyles(): void {
  const style = document.createElement('style');
  style.textContent = AI_BUTTON_CSS;
  document.documentElement.appendChild(style);
}

// The AI-answer buttons show on the autofill boards (adapter) and, on any other
// site, once the user has an active saved job — so "save this job" lights up the
// "✨ AI answer" button next to that application's free-text questions anywhere.
let questionsOn = false;
let stylesInjected = false;

function setQuestionButtons(on: boolean): void {
  if (on === questionsOn) return;
  questionsOn = on;
  if (on) {
    if (!stylesInjected) {
      injectStyles();
      stylesInjected = true;
    }
    injectQuestionButtons();
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    observer.disconnect();
    window.clearTimeout(pending); // cancel any debounced re-inject still queued
    // Remove only OUR buttons; a later re-enable rebuilds them from scratch.
    document
      .querySelectorAll<HTMLButtonElement>(`.${BUTTON_CLASS}`)
      .forEach((n) => ownedButtons.has(n) && n.remove());
  }
}

const recomputeQuestions = (activeId: string | null) =>
  setQuestionButtons(!!adapter || !!activeId);

getSavedJobs().then((s) => recomputeQuestions(s.activeId));
onSavedJobsChanged((s) => recomputeQuestions(s.activeId));

// Eligibility badges and document generators are intentionally not started.
