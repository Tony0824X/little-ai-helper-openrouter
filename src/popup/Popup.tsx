import { useEffect, useRef, useState } from 'react';
import { getProfile, onProfileChanged, type Profile } from '../lib/profile';
import {
  getSavedJobs,
  addJob,
  setActiveJob,
  deleteJob,
  onSavedJobsChanged,
  isJobTextTruncated,
  type SavedJob,
} from '../lib/savedJobs';
import { sendToTab } from '../lib/messages';
import type { CapturedJob, PageInfo } from '../lib/messages';
import type { FormProgress } from '../lib/formPlan';
import { saveJobNotice, timeAgo } from './notices';
import { SavedJobTextMeta } from './SavedJobTextMeta';
import { PAGE_CONNECTION_MESSAGE, readPageInfo } from './pageConnection';

export function Popup() {
  const [tabId, setTabId] = useState<number | null>(null);
  const [page, setPage] = useState<PageInfo | null>(null);
  const [pageConnecting, setPageConnecting] = useState(true);
  const [pageConnectionError, setPageConnectionError] = useState('');
  const refreshVersion = useRef({ value: 0 });
  // AI config, derived from the profile, for the "configure AI" hints.
  const [apiKeySet, setApiKeySet] = useState(false);
  const [fillMsg, setFillMsg] = useState('');
  const [busy, setBusy] = useState<'' | 'fill' | 'save'>('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<FormProgress | null>(null);
  const currentTab = useRef<number | null>(null);
  const [jobs, setJobs] = useState<SavedJob[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobMutationPending, setJobMutationPending] = useState(false);
  const savedJobPending = jobMutationPending || busy === 'save';
  // Which saved-job rows show their capture preview. Collapsed by default; the
  // user expands a row (chevron) to verify what text was captured for the AI.
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());
  const fillMsgTimer = useRef<number | null>(null);

  function flashFillMsg(message: string) {
    if (fillMsgTimer.current !== null) {
      clearTimeout(fillMsgTimer.current);
    }
    setFillMsg(message);
    fillMsgTimer.current = window.setTimeout(() => {
      setFillMsg('');
      fillMsgTimer.current = null;
    }, 1500);
  }

  function toggleJobExpanded(id: string) {
    setExpandedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Re-read the active tab's job info. Runs on mount and whenever the user
  // switches tabs or navigates (the side panel stays open across all of that).
  async function refresh() {
    const version = ++refreshVersion.current.value;
    setPageConnecting(true);
    setPage(null);
    setPageConnectionError('');
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (version !== refreshVersion.current.value) return;
      if (!tab?.id) { setTabId(null); return; }
      setTabId(tab.id);
      if (currentTab.current !== tab.id) { setProgress(null); setBusy(''); }
      currentTab.current = tab.id;
      const info = await readPageInfo(tab.id);
      // A delayed reply from the previous tab must not disable the new tab.
      if (version !== refreshVersion.current.value) return;
      setPage(info);
      if (info.supported) {
        const status = await sendToTab<FormProgress | null>(tab.id, { type: 'PAGE_FILL_STATUS' }).catch(() => null);
        if (version === refreshVersion.current.value && status?.type === 'FORM_PROGRESS') {
          setProgress(status); setBusy(status.running ? 'fill' : '');
        }
      }
    } catch {
      if (version === refreshVersion.current.value) setPageConnectionError(PAGE_CONNECTION_MESSAGE);
    } finally {
      if (version === refreshVersion.current.value) setPageConnecting(false);
    }
  }

  async function reloadJobPage() {
    if (!tabId) return;
    try { await chrome.tabs.reload(tabId); await refresh(); }
    catch { setPageConnectionError('Could not reload this tab. Refresh the job page in Chrome, then try again.'); }
  }

  // Keep the API-key setup hint in sync with the profile settings.
  useEffect(() => {
    const apply = (p: Profile) => {
      setApiKeySet(!!p.ai.apiKey.trim());
    };
    getProfile().then(apply);
    return onProfileChanged(apply);
  }, []);

  useEffect(() => {
    const apply = (s: { jobs: SavedJob[]; activeId: string | null }) => {
      setJobs(s.jobs);
      setActiveJobId(s.activeId);
    };
    getSavedJobs().then(apply);
    return onSavedJobsChanged(apply);
  }, []);

  useEffect(() => {
    const pendingRefresh = refreshVersion.current;
    refresh();
    const onActivated = () => refresh();
    const onUpdated = (_id: number, change: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => {
      if (tab.active && change.status) refresh();
    };
    const onReady = (msg: { type?: string }, sender: chrome.runtime.MessageSender) => {
      if (msg?.type === 'PAGE_READY') void refresh();
      if (msg?.type === 'FORM_PROGRESS' && sender.tab?.id === currentTab.current) {
        const status = msg as FormProgress;
        setProgress(status); setBusy(status.running ? 'fill' : '');
      }
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.runtime.onMessage.addListener(onReady);
    return () => {
      ++pendingRefresh.value;
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.runtime.onMessage.removeListener(onReady);
      if (fillMsgTimer.current !== null) clearTimeout(fillMsgTimer.current);
    };
  }, []);

  async function onFill() {
    if (!tabId) return;
    setBusy('fill');
    setFillMsg('');
    setError('');
    const targetTab = tabId;
    const requestId = crypto.randomUUID();
    setProgress({ type: 'FORM_PROGRESS', requestId, running: true, phase: 'Connecting to this form…', filled: 0, total: 0, logs: [] });
    try {
      const res = await sendToTab<FormProgress>(tabId, { type: 'PAGE_FILL', requestId });
      if (currentTab.current === targetTab) {
        if (res?.type === 'FORM_PROGRESS') setProgress(res);
        else { setProgress(null); setError(res?.error || 'No fill response. Reload the page and retry.'); }
      }
    } catch {
      if (currentTab.current === targetTab) { setProgress(null); setError('Could not reach the page. Reload the job page and try again.'); }
    } finally {
      if (currentTab.current === targetTab) setBusy('');
    }
  }

  async function onUseCurrentPage() {
    if (savedJobPending) return;
    setJobMutationPending(true);
    setError('');
    try {
      await setActiveJob(null);
      flashFillMsg('Now using the current page for AI answers.');
    } catch {
      setError('Could not update the active job. Try again.');
    } finally {
      setJobMutationPending(false);
    }
  }

  async function onPickJob(id: string) {
    if (savedJobPending) return;
    setJobMutationPending(true);
    setError('');
    try {
      await setActiveJob(id === activeJobId ? null : id);
      if (id === activeJobId) {
        flashFillMsg('Now using the current page for AI answers.');
      } else {
        flashFillMsg('Using saved job for AI answers.');
      }
    } catch {
      setError('Could not update the active job. Try again.');
    } finally {
      setJobMutationPending(false);
    }
  }

  async function onDeleteJob(id: string) {
    if (savedJobPending) return;
    setJobMutationPending(true);
    setError('');
    try {
      await deleteJob(id);
      flashFillMsg('Job deleted.');
    } catch {
      setError('Could not delete the job. Try again.');
    } finally {
      setJobMutationPending(false);
    }
  }

  async function onSaveJob() {
    if (!tabId || savedJobPending) return;
    setError('');
    setBusy('save');
    try {
      const cap = await sendToTab<CapturedJob>(tabId, { type: 'CAPTURE_JOB' });
      if (!cap.text || cap.text.trim().length < 40) {
        setError('No job posting detected on this page to save.');
        return;
      }
      const { evicted } = await addJob({
        company: cap.company,
        role: cap.role || cap.title,
        url: cap.url,
        text: cap.text,
      });
      flashFillMsg(
        saveJobNotice({
          truncated: isJobTextTruncated(cap.text),
          evicted: evicted.length > 0,
        }),
      );
    } catch {
      setError('Could not read this page. Reload it and try again.');
    } finally {
      setBusy('');
    }
  }

  const activeJob = jobs.find((j) => j.id === activeJobId) ?? null;
  const openOptions = () => chrome.runtime.openOptionsPage();
  const openRouterNeedsKey = !apiKeySet;

  return (
    <div className="popup">
      <header className="brand">
        <span className="brand-logo" aria-hidden>
          <img src={chrome.runtime.getURL('icons/icon128.png')} alt="" width={36} height={36} />
        </span>
        <div className="brand-text">
          <h1>Little AI Helper</h1>
          <p className="tagline">OpenRouter · free models</p>
        </div>
        <button
          className="ghost icon-btn"
          title="Refresh for the current tab"
          aria-label="Refresh for the current tab"
          onClick={() => refresh()}
        >
          ↻
        </button>
      </header>

      {pageConnecting ? (
        <p className="muted" role="status">Connecting to the current page…</p>
      ) : pageConnectionError ? (
        <div className="block warn" role="status">
          {pageConnectionError}
          <button className="full" onClick={reloadJobPage} disabled={!tabId}>Reload job page</button>
        </div>
      ) : page?.supported ? (
        <p className="muted">
          <span className="pill">{page.site}</span>{' '}
          {page.role || 'job page'} {page.company && `· ${page.company}`}
        </p>
      ) : (
        <p className="muted">
          Open an application form. AI can read standard fields and common dropdowns on different websites.
        </p>
      )}

      {openRouterNeedsKey && (
        <div className="block warn">
          Add your OpenRouter key to use AI.{' '}
          <a onClick={openOptions} style={{ cursor: 'pointer' }}>Set it up →</a>
        </div>
      )}

      <div className="block">
        <button
          className="primary"
          disabled={!page?.supported || busy !== '' || openRouterNeedsKey}
          onClick={onFill}
          aria-label={busy === 'fill' ? 'Filling page' : 'Fill this page with AI'}
        >
          {busy === 'fill' ? <><span className="fill-spinner" aria-hidden="true" /> AI is filling…</> : 'Fill this page with AI'}
        </button>
        <p className="muted fill-help">Sends your CV/profile and the complete loaded form structure to OpenRouter. Fills the current step, then checks the entered values.</p>
        {progress && <div className="fill-progress" aria-live="polite" aria-busy={progress.running}>
          <strong>{progress.phase}</strong>
          <p>{progress.filled} filled · {progress.logs.filter(l => l.status === 'skipped').length} to review · {progress.total} fields on this step</p>
          {progress.sent !== undefined && <p className="muted">{progress.sent} field groups sent as context{progress.pending ? ` · ${progress.pending} on other loaded steps` : ''}. Review answers before submitting.</p>}
          {progress.error && <p className="error">{progress.error}</p>}
          {progress.running && <button className="ghost" onClick={() => tabId && sendToTab(tabId, { type: 'PAGE_FILL_CANCEL' })}>Stop after current step</button>}
          <details><summary>Debug messages ({progress.logs.length})</summary>
            <ul className="fill-log">{progress.logs.map((log, i) => <li key={i} data-status={log.status}><b>{log.status === 'filled' ? '✓' : log.status === 'info' ? 'ℹ' : '–'} {log.label}</b><span>{log.message}</span></li>)}</ul>
          </details>
        </div>}
        {fillMsg && <div className="status">{fillMsg}</div>}
      </div>

      <div className="block savedjob" aria-busy={savedJobPending}>
        <button
          className="full"
          onClick={onSaveJob}
          disabled={busy !== '' || jobMutationPending || !tabId}
          aria-label={busy === 'save' ? 'Saving job details' : 'Save this job'}
        >
          {busy === 'save' ? 'Saving…' : '💾 Save this job'}
        </button>
        {activeJob ? (
            <div className="jobusing">
              Using a saved job for AI answers.{' '}
              <button className="ghost jobclear" disabled={savedJobPending} onClick={onUseCurrentPage}>
                use current page
              </button>
            </div>
        ) : (
          jobs.length > 0 && (
            <div className="jobusing muted">
              Using the current page. Pick a saved job to reuse its posting.
            </div>
          )
        )}
        {jobs.length > 0 && (
          <div className="joblist">
            {jobs.map((j) => {
              const expanded = expandedJobs.has(j.id);
              return (
                <div key={j.id} className={`jobitem${j.id === activeJobId ? ' active' : ''}`}>
                  <div className="jobrow">
                    <button
                      className="jobpick"
                      disabled={savedJobPending}
                      title="Use this posting as the context for AI answers"
                      onClick={() => onPickJob(j.id)}
                      aria-label={`${j.id === activeJobId ? 'Stop using' : 'Use'} ${j.role || 'saved job'}${j.company ? ` at ${j.company}` : ''} as AI context`}
                    >
                      <span className="dot" />
                      <span className="jobname">
                        {j.role || 'Saved job'}
                        {j.company ? ` · ${j.company}` : ''}
                      </span>
                    </button>
                    <button
                      className="jobtoggle"
                      title={expanded ? 'Hide what was saved' : 'Show what was saved'}
                      aria-expanded={expanded}
                      aria-label={expanded ? `Hide saved details for ${j.role || 'job'}${j.company ? ` at ${j.company}` : ''}` : `Show saved details for ${j.role || 'job'}${j.company ? ` at ${j.company}` : ''}`}
                      onClick={() => toggleJobExpanded(j.id)}
                    >
                      {expanded ? '▴' : '▾'}
                    </button>
                    <button
    className="jobdel"
    disabled={savedJobPending}
    title="Delete"
  aria-label={`Delete ${j.role || 'saved job'}…`}
  onClick={() => {
    if (window.confirm(`Delete the saved job "${j.role || 'this job'}"? This can't be undone.`)) {
      onDeleteJob(j.id);
    }
  }}
>
  ×
</button>
                  </div>
                  {expanded && (
                    <div className="jobpreview">
                      <div className="jobmeta">
                        <SavedJobTextMeta textLength={j.text.length} />
                        <time
                          dateTime={new Date(j.savedAt).toISOString()}
                          title={new Date(j.savedAt).toLocaleString()}
                        >
                          saved {timeAgo(j.savedAt)}
                        </time>
                        {j.url?.trim() ? (
                          <a
                            href={j.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={j.url}
                          >
                            Open original posting ↗
                          </a>
                        ) : null}
                      </div>
                      <div className="jobsnippet">
                        {j.text.trim() || '(no text captured)'}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {error && <div className="status warn">{error}</div>}

      <div className="block" style={{ textAlign: 'center' }}>
        <button className="ghost" onClick={openOptions}>
          Edit profile &amp; settings
        </button>
      </div>
    </div>
  );
}
