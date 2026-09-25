import { useMemo, useState } from 'react';
import { Field } from './Field';
import {
  computeContextUsage,
  saveProfile,
  shadowedByLaterUpload,
  upsertDocument,
  type EducationEntry,
  type Profile,
  type WorkEntry,
} from '../lib/profile';
import { useProfile } from '../ui/useProfile';
import { extractText, extractTextBatch } from '../lib/documents';
import { sendToBackground } from '../lib/messages';
import type { AIResult } from '../lib/messages';
import { mergeResumeProfile, parseResumeJson } from '../lib/resumeImport';
import { OpenRouterProvider } from '../lib/ai/openrouter';
import { OPENROUTER_MODELS } from '../lib/ai/openrouterModels';
import { AIError } from '../lib/ai';

export function Options() {
  const { profile, loaded, saveState, saveError, update } = useProfile();

  if (!loaded) return <div className="options">Loading…</div>;

  const p = profile;
  const setPersonal = (k: keyof Profile['personal'], v: string) =>
    update((prev) => ({ ...prev, personal: { ...prev.personal, [k]: v } }));
  const setPref = (k: keyof Profile['preferences'], v: string) =>
    update((prev) => ({ ...prev, preferences: { ...prev.preferences, [k]: v } }));
  const setAI = (k: keyof Profile['ai'], v: string) =>
    update((prev) => ({ ...prev, ai: { ...prev.ai, [k]: v } }));

  return (
    <OptionsView
      p={p}
      saveState={saveState}
      saveError={saveError}
      setPersonal={setPersonal}
      setPref={setPref}
      setAI={setAI}
      update={update}
    />
  );
}

function OptionsView({
  p,
  saveState,
  saveError,
  setPersonal,
  setPref,
  setAI,
  update,
}: {
  p: Profile;
  saveState: ReturnType<typeof useProfile>['saveState'];
  saveError: ReturnType<typeof useProfile>['saveError'];
  setPersonal: (k: keyof Profile['personal'], v: string) => void;
  setPref: (k: keyof Profile['preferences'], v: string) => void;
  setAI: (k: keyof Profile['ai'], v: string) => void;
  update: ReturnType<typeof useProfile>['update'];
}) {
  const [importState, setImportState] = useState<{ busy: boolean; msg: string; err: string }>({
    busy: false,
    msg: '',
    err: '',
  });
  // Snapshot of the profile taken right before the last import, for undo.
  const [undoSnapshot, setUndoSnapshot] = useState<Profile | null>(null);
  const [connectionTest, setConnectionTest] = useState<{ busy: boolean; msg: string; err: string }>({
    busy: false,
    msg: '',
    err: '',
  });
  const [showApiKey, setShowApiKey] = useState(false);

  // Which uploaded documents have their "exact text sent to the AI" preview open.
  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set());
  function toggleDocExpanded(id: string): void {
    setExpandedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const contextUsage = useMemo(() => computeContextUsage(p), [p]);
  const docUsage = useMemo(
    () => new Map(contextUsage.documents.map((u) => [u.id, u])),
    [contextUsage],
  );

  async function testConnection(): Promise<void> {
    setConnectionTest({ busy: true, msg: '', err: '' });
    try {
      const text = await new OpenRouterProvider(p.ai.apiKey, p.ai.model).generate({
        system: 'You are a connectivity test. Reply with exactly OK.',
        prompt: 'Reply with OK.',
        maxOutputTokens: 64,
      });
      setConnectionTest({ busy: false, err: '', msg: `Connected ✓ (${p.ai.model}: ${text.slice(0, 40)})` });
    } catch (e) {
      setConnectionTest({ busy: false, msg: '', err: e instanceof AIError ? e.message : 'Connection test failed.' });
    }
  }

  /** Extracts personal details, work, education, skills and stated preferences. */
  async function importFromResume(text: string): Promise<void> {
    if (!text.trim()) {
      setImportState({ busy: false, msg: '', err: 'Add some resume text first.' });
      return;
    }
    setImportState({ busy: true, msg: '', err: '' });
    try {
      // Settings auto-save after 500 ms. A quick upload immediately after
      // entering a key must not send the background worker an older profile.
      await saveProfile({ ...p, resumeText: text });
      const res = await sendToBackground<AIResult>({ type: 'AI_PARSE_RESUME', text });
      if (res.error) {
        setImportState({ busy: false, msg: '', err: res.error });
        return;
      }
      const parsed = parseResumeJson(res.text);
      const personalCount = Object.keys(parsed.personal).length;
      // Capture the pre-import profile so the user can undo a bad parse.
      setUndoSnapshot(structuredClone(p));
      update((prev) => mergeResumeProfile(prev, parsed, p));
      setImportState({
        busy: false,
        err: '',
        msg: `Imported ${personalCount} personal field(s), ${parsed.work.length} role(s), ${parsed.education.length} education entr(ies), ${parsed.skills.length} skill(s). Found ${Object.keys(parsed.preferences).length} preference(s); missing facts and new edits are preserved.`,
      });
    } catch (e) {
      setImportState({ busy: false, msg: '', err: (e as Error).message });
    }
  }

  function undoImport(): void {
    if (!undoSnapshot) return;
    const snapshot = undoSnapshot;
    update(() => snapshot);
    setUndoSnapshot(null);
    setImportState({ busy: false, err: '', msg: 'Reverted to the profile from before the import.' });
  }

  return (
    <div className="options">
      <div className="toolbar">
        <h1 style={{ flex: 1 }}>Little AI Helper — OpenRouter Settings</h1>
        {saveState === 'saving' && <span className="help">Saving…</span>}
        {saveState === 'saved' && <span className="saved">✓ Saved</span>}
        {saveState === 'error' && saveError && <span className="warn">{saveError}</span>}
      </div>
      <p className="sub">
        Your profile is saved on this device. When you use AI, relevant resume, document, and
        job text is sent to OpenRouter and the model provider. Your key is sent only to OpenRouter.
      </p>

      <section className="card">
        <h2>OpenRouter · Free models</h2>
        <p className="help">Use your own OpenRouter key. No Google sign-in or separate server is needed.</p>
        <Field label="Free model (used for every AI feature)">
          <select value={p.ai.model} onChange={(e) => setAI('model', e.target.value)}>
            {OPENROUTER_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <div className="help">Dots3-Note Preview passed live connection and Chinese resume JSON tests on 25 Sep 2026 at $0 cost. Free providers can be busy even when your daily quota remains. Paid endpoints are blocked.</div>
        </Field>
        <Field label="OpenRouter API key">
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type={showApiKey ? 'text' : 'password'} autoComplete="off" spellCheck={false}
              value={p.ai.apiKey} placeholder="sk-or-v1-…"
              onChange={(e) => { setAI('apiKey', e.target.value); setConnectionTest({ busy: false, msg: '', err: '' }); }}
            />
            <button className="ghost" type="button" aria-label={showApiKey ? 'Hide API key' : 'Show API key'} onClick={() => setShowApiKey((visible) => !visible)}>
              {showApiKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <div className="help">
            Create a key at <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">openrouter.ai/settings/keys</a>.
            {' '}Free models have daily and per-minute limits. AI runs only when you request it.
          </div>
        </Field>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="primary" disabled={connectionTest.busy || !p.ai.apiKey.trim()} onClick={testConnection}>
            {connectionTest.busy ? 'Testing…' : 'Test OpenRouter connection'}
          </button>
          {connectionTest.msg && <span className="saved" role="status">{connectionTest.msg}</span>}
          {connectionTest.err && <span className="warn" role="alert">{connectionTest.err}</span>}
        </div>
        <p className="help">The connection test sends only “Reply with OK” and uses one free-model request.</p>
      </section>

      {/* Resume import */}
      <section className="card">
        <h2>Attach resume (auto-fills the sections below)</h2>
        <ResumeUpload
          busy={importState.busy}
          onText={async (text) => {
            update((prev) => ({ ...prev, resumeText: text }));
            await importFromResume(text);
          }}
        />
        <Field label="Resume text (primary AI context)">
          <textarea
            style={{ minHeight: 160 }}
            value={p.resumeText}
            placeholder="Paste your resume here, or upload a PDF/DOCX above."
            onChange={(e) => update((prev) => ({ ...prev, resumeText: e.target.value }))}
          />
        </Field>
        {contextUsage.resume.usedChars < contextUsage.resume.totalChars && (
          <p className="warn">
            Only {contextUsage.resume.usedChars.toLocaleString()} of{' '}
            {contextUsage.resume.totalChars.toLocaleString()} chars are sent to the AI — shorten
            the resume to use the rest.
          </p>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            className="primary"
            disabled={importState.busy}
            onClick={() => importFromResume(p.resumeText)}
          >
            {importState.busy ? 'Reading with AI…' : '✨ Auto-fill profile & preferences from CV'}
          </button>
          {undoSnapshot && (
            <button className="ghost" disabled={importState.busy} onClick={undoImport}>
              ↶ Undo last import
            </button>
          )}
          {importState.msg && <span className="saved">{importState.msg}</span>}
          {importState.err && <span className="warn">{importState.err}</span>}
        </div>
        <div className="help">
          Uses your AI provider to read the resume and fill the Personal, Work, Education, Skills and Preferences
          sections below. Review the results — it can occasionally misread dates or titles.
        </div>
      </section>

      {/* Personal */}
      <section className="card">
        <h2>Personal</h2>
        <div className="row">
          <Field label="First name">
            <input value={p.personal.firstName} onChange={(e) => setPersonal('firstName', e.target.value)} />
          </Field>
          <Field label="Last name">
            <input value={p.personal.lastName} onChange={(e) => setPersonal('lastName', e.target.value)} />
          </Field>
        </div>
        <div className="row">
          <Field label="Email">
            <input value={p.personal.email} onChange={(e) => setPersonal('email', e.target.value)} />
          </Field>
          <Field label="Phone">
            <input value={p.personal.phone} onChange={(e) => setPersonal('phone', e.target.value)} />
          </Field>
        </div>
        <div className="row-3">
          <Field label="City">
            <input value={p.personal.city} onChange={(e) => setPersonal('city', e.target.value)} />
          </Field>
          <Field label="State/Region">
            <input value={p.personal.state} onChange={(e) => setPersonal('state', e.target.value)} />
          </Field>
          <Field label="Country">
            <input value={p.personal.country} onChange={(e) => setPersonal('country', e.target.value)} />
          </Field>
        </div>
        <div className="row-3">
          <Field label="LinkedIn">
            <input value={p.personal.linkedin} onChange={(e) => setPersonal('linkedin', e.target.value)} />
          </Field>
          <Field label="GitHub">
            <input value={p.personal.github} onChange={(e) => setPersonal('github', e.target.value)} />
          </Field>
          <Field label="Portfolio">
            <input value={p.personal.portfolio} onChange={(e) => setPersonal('portfolio', e.target.value)} />
          </Field>
        </div>
      </section>

      {/* Work history */}
      <section className="card">
        <h2>Work history</h2>
        {p.workHistory.map((w, i) => (
          <WorkRow
            key={i}
            entry={w}
            onChange={(next) =>
              update((prev) => {
                const list = [...prev.workHistory];
                list[i] = next;
                return { ...prev, workHistory: list };
              })
            }
            onRemove={() =>
              update((prev) => ({
                ...prev,
                workHistory: prev.workHistory.filter((_, j) => j !== i),
              }))
            }
          />
        ))}
        <button
          className="ghost"
          onClick={() =>
            update((prev) => ({
              ...prev,
              workHistory: [
                ...prev.workHistory,
                { company: '', title: '', startDate: '', endDate: '', description: '' },
              ],
            }))
          }
        >
          + Add role
        </button>
      </section>

      {/* Education */}
      <section className="card">
        <h2>Education</h2>
        {p.education.map((ed, i) => (
          <EducationRow
            key={i}
            entry={ed}
            onChange={(next) =>
              update((prev) => {
                const list = [...prev.education];
                list[i] = next;
                return { ...prev, education: list };
              })
            }
            onRemove={() =>
              update((prev) => ({ ...prev, education: prev.education.filter((_, j) => j !== i) }))
            }
          />
        ))}
        <button
          className="ghost"
          onClick={() =>
            update((prev) => ({
              ...prev,
              education: [...prev.education, { school: '', degree: '', field: '', graduationYear: '' }],
            }))
          }
        >
          + Add education
        </button>
      </section>

      {/* Skills */}
      <section className="card">
        <h2>Skills</h2>
        <Field label="Separate with commas or new lines">
          <textarea
            style={{ minHeight: 90 }}
            value={p.skills.join(', ')}
            onChange={(e) =>
              update((prev) => ({
                ...prev,
                skills: e.target.value
                  .split(/[,\n]/)
                  .map((s) => s.trim())
                  .filter(Boolean),
              }))
            }
          />
        </Field>
      </section>

      {/* Additional documents */}
      <section className="card">
        <h2>Additional documents (extra AI context)</h2>
        <DocUpload
          onText={(name, text) =>
            update((prev) => ({ ...prev, documents: upsertDocument(prev.documents, name, text) }))
          }
        />
        {p.documents.length > 0 && (
          <div style={{ margin: '10px 0' }}>
            {p.documents.map((d) => {
              const u = docUsage.get(d.id);
              const trimmed = !!u && u.usedChars < u.totalChars;
              const expanded = expandedDocs.has(d.id);
              return (
                <div key={d.id} className="list-item">
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={{ flex: 1 }}>
                      📄 {d.name} <span className="help">({d.text.length.toLocaleString()} chars)</span>
                      {trimmed && (
                        <span className="warn">
                          {' — '}
                          {u!.usedChars === 0
                            ? 'not sent (AI context budget full)'
                            : `${u!.usedChars.toLocaleString()} of ${u!.totalChars.toLocaleString()} chars used for AI`}
                        </span>
                      )}
                    </span>
                    <button
                      className="jobtoggle"
                      title={expanded ? 'Hide what is sent to the AI' : 'Show what is sent to the AI'}
                      aria-expanded={expanded}
                      aria-label={`${expanded ? 'Hide' : 'Show'} the exact text sent to the AI for ${d.name}`}
                      onClick={() => toggleDocExpanded(d.id)}
                    >
                      {expanded ? '▴' : '▾'}
                    </button>
                    <button
                      className="danger"
                      onClick={() =>
                        update((prev) => ({
                          ...prev,
                          documents: prev.documents.filter((x) => x.id !== d.id),
                        }))
                      }
                    >
                      Remove
                    </button>
                  </div>
                  {expanded && (
                    <div className="jobpreview">
                      <div className="jobmeta">
                        <span>
                          {(u?.usedChars ?? 0).toLocaleString()} of{' '}
                          {(u?.totalChars ?? 0).toLocaleString()} chars sent to the AI
                        </span>
                      </div>
                      <div className="jobsnippet">
                        {u?.usedText || '(none of this document is sent to the AI)'}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Preferences */}
      <section className="card">
        <h2>Preferences</h2>
        <p className="help">Imported when explicitly stated in your CV. Missing facts stay unchanged; you can edit these answers below.</p>
        <div className="row">
          <Field label="Work authorization">
            <input value={p.preferences.workAuthorization} onChange={(e) => setPref('workAuthorization', e.target.value)} />
          </Field>
          <Field label="Requires sponsorship? (Yes/No)">
            <input value={p.preferences.requiresSponsorship} onChange={(e) => setPref('requiresSponsorship', e.target.value)} />
          </Field>
        </div>
        <Field label="Salary expectation">
          <input value={p.preferences.salaryExpectation} onChange={(e) => setPref('salaryExpectation', e.target.value)} />
        </Field>
      </section>

      <footer className="help" style={{ marginTop: 16, textAlign: 'center' }}>
        Little AI Helper v{chrome.runtime.getManifest().version}
      </footer>
    </div>
  );
}

function WorkRow({
  entry,
  onChange,
  onRemove,
}: {
  entry: WorkEntry;
  onChange: (e: WorkEntry) => void;
  onRemove: () => void;
}) {
  const set = (k: keyof WorkEntry, v: string) => onChange({ ...entry, [k]: v });
  return (
    <div className="list-item">
      <div className="row">
        <Field label="Title">
          <input value={entry.title} onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Field label="Company">
          <input value={entry.company} onChange={(e) => set('company', e.target.value)} />
        </Field>
      </div>
      <div className="row">
        <Field label="Start (e.g. 2022)">
          <input value={entry.startDate} onChange={(e) => set('startDate', e.target.value)} />
        </Field>
        <Field label="End (or 'present')">
          <input value={entry.endDate} onChange={(e) => set('endDate', e.target.value)} />
        </Field>
      </div>
      <Field label="What you did">
        <textarea value={entry.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
      <button className="danger" onClick={onRemove}>
        Remove role
      </button>
    </div>
  );
}

function EducationRow({
  entry,
  onChange,
  onRemove,
}: {
  entry: EducationEntry;
  onChange: (e: EducationEntry) => void;
  onRemove: () => void;
}) {
  const set = (k: keyof EducationEntry, v: string) => onChange({ ...entry, [k]: v });
  return (
    <div className="list-item">
      <div className="row">
        <Field label="School">
          <input value={entry.school} onChange={(e) => set('school', e.target.value)} />
        </Field>
        <Field label="Degree">
          <input value={entry.degree} onChange={(e) => set('degree', e.target.value)} />
        </Field>
      </div>
      <div className="row">
        <Field label="Field of study">
          <input value={entry.field} onChange={(e) => set('field', e.target.value)} />
        </Field>
        <Field label="Graduation year">
          <input value={entry.graduationYear} onChange={(e) => set('graduationYear', e.target.value)} />
        </Field>
      </div>
      <button className="danger" onClick={onRemove}>
        Remove
      </button>
    </div>
  );
}

function ResumeUpload({
  onText,
  busy,
}: {
  onText: (text: string) => void | Promise<void>;
  busy: boolean;
}) {
  const [reading, setReading] = useState(false);
  const [warn, setWarn] = useState('');

  async function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setReading(true);
    setWarn('');
    try {
      const { text, warning } = await extractText(file);
      if (warning) setWarn(warning);
      if (text) await onText(text);
    } catch (err) {
      setWarn(`Could not read file: ${(err as Error).message}`);
    } finally {
      setReading(false);
    }
  }

  return (
    <div className="field">
      <label>Upload resume (PDF / DOCX / TXT) — extracts text, then auto-fills</label>
      <input type="file" accept=".pdf,.docx,.txt,.md" onChange={handle} disabled={reading || busy} />
      {reading && <div className="help">Extracting text…</div>}
      {warn && <div className="warn">{warn}</div>}
    </div>
  );
}

function DocUpload({ onText }: { onText: (name: string, text: string) => void }) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // One entry per file that had a problem, so a bad file in a batch of good
  // ones is identifiable rather than a single anonymous "could not read file".
  const [warnings, setWarnings] = useState<string[]>([]);

  async function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;

    setWarnings([]);
    setProgress({ done: 0, total: files.length });

    const results = await extractTextBatch(files, (done, total) => setProgress({ done, total }));

    // Detect a same-batch name collision (e.g. two files both literally named
    // "resume.pdf" from different folders) BEFORE upserting: onText's upserts
    // below leave only the last one's text, with nothing on screen to explain
    // why the other vanished unless this warns about it now (#333).
    const texted = results.filter((r) => r.text);
    const shadowed = shadowedByLaterUpload(texted.map((r) => r.name));
    const collisionWarnings = texted
      .filter((_, i) => shadowed.has(i))
      .map((r) => `${r.name}: replaced by another file with the same name in this upload`);

    for (const r of results) {
      if (r.text) onText(r.name, r.text);
    }
    setProgress(null);
    setWarnings([
      ...results.filter((r) => r.warning).map((r) => `${r.name}: ${r.warning}`),
      ...collisionWarnings,
    ]);
  }

  const busy = progress !== null;
  return (
    <div className="field">
      <label>Upload PDF / DOCX / TXT — you can pick several at once</label>
      <input type="file" accept=".pdf,.docx,.txt,.md" multiple onChange={handle} disabled={busy} />
      {progress && (
        <div className="help">
          {progress.total === 1
            ? 'Extracting text…'
            : `Extracting text… ${progress.done} of ${progress.total}`}
        </div>
      )}
      {warnings.map((w) => (
        <div className="warn" key={w}>
          {w}
        </div>
      ))}
    </div>
  );
}
