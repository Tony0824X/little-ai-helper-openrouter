import { captureFields, discoverComboOptions, applyAnswer, verifyAnswer, refreshBinding, watchUserEdits, type FieldBinding } from './formFields';
import { buildFormDocument } from './formDocument';
import { parseFormPlan, type FormAnswer, type FormProgress, type FillLog } from '../lib/formPlan';
import { sendToBackground, type AIResult } from '../lib/messages';
import { getScanText } from './sponsorship';

let state: FormProgress | null = null;
let cancelled = false;
export function fillStatus(): FormProgress | null { return state; }
export function cancelFill(): void { cancelled = true; }
function update(patch: Partial<FormProgress>): void {
  if (!state) return;
  state = { ...state, ...patch };
  void chrome.runtime.sendMessage(state).catch(() => {});
}
export async function runAiFill(requestId: string): Promise<FormProgress> {
  if (state?.running) throw new Error('A fill is already running on this page.');
  cancelled = false;
  state = { type: 'FORM_PROGRESS', requestId, phase: 'Reading the complete loaded form…', logs: [], filled: 0, total: 0, running: true };
  update({});
  let stopWatching = () => {};
  try {
    const bindings = captureFields(true);
    stopWatching = watchUserEdits(bindings);
    const current = bindings.filter(b => b.field.visible !== false);
    const eligible = current.filter(b => !b.field.blocked && !b.field.hasValue);
    update({ total: current.length, pending: bindings.length - current.length, phase: 'Reading groups, tables and dropdown choices…' });
    await discoverComboOptions(eligible, () => cancelled);
    if (cancelled) { update({ phase: 'Cancelled', running: false }); return state!; }
    const document = buildFormDocument(bindings);
    const fields = bindings.map(b => b.field);
    const notes: FillLog[] = [
      { label: 'Complete form', status: 'info', message: `${fields.length} field groups and ${document.structure.length} characters of cleaned form HTML; ${eligible.length} fields to answer on this step. All field definitions and the complete structure accompany every AI request.` },
      ...document.warnings.map(message => ({ label: 'Form scope', status: 'info' as const, message })),
      ...current.filter(b => b.field.blocked || b.field.hasValue).map(b => ({ label: b.field.label, status: 'skipped' as const, message: b.field.blocked || 'Existing value preserved.' })),
    ];
    const results = new Map<FieldBinding, FillLog>();
    const publish = () => update({ logs: [...notes, ...results.values()], filled: [...results.values()].filter(r => r.status === 'filled').length });
    update({ logs: notes, sent: fields.length });
    if (!eligible.length) { update({ phase: 'Nothing new to fill on this step', running: false }); return state!; }

    async function ask(targets: FieldBinding[], repairing = false): Promise<FormAnswer[]> {
      const answers: FormAnswer[] = [];
      // Bound output size while keeping the WHOLE form in every input. No field
      // or section is silently dropped when a large form needs multiple replies.
      for (let offset = 0; offset < targets.length && !cancelled; offset += 60) {
        const batch = targets.slice(offset, offset + 60);
        update({ phase: `${repairing ? 'Checking missed answers' : 'OpenRouter is reading the complete form'}… ${Math.min(offset + 60, targets.length)}/${targets.length}` });
        const reply = await sendToBackground<AIResult>({ type: 'AI_FILL_FORM', fields, document, targetIds: batch.map(b => b.field.id), jobText: getScanText() });
        if (cancelled) return [];
        if (reply.error) throw new Error(reply.error);
        answers.push(...parseFormPlan(reply.text, batch.map(b => b.field)).answers);
      }
      return answers;
    }
    const plan = await ask(eligible);
    if (cancelled) { update({ phase: 'Cancelled — AI response discarded', running: false }); return state!; }
    notes.push({ label: 'AI response', status: 'info', message: `${plan.length}/${eligible.length} requested field answers returned as JSON. Only local field IDs can be filled.` });
    // Country widgets must settle before the adjacent phone input is written.
    const ordered = [...eligible].sort((a, b) => Number(b.field.kind === 'phone-country') - Number(a.field.kind === 'phone-country'));
    update({ phase: 'Entering AI answers into the page…' });
    for (const binding of ordered) {
      if (cancelled) break;
      const answer = plan.find(a => a.id === binding.field.id);
      results.set(binding, answer ? await applyAnswer(binding, answer, () => cancelled) : { label: binding.field.label, status: 'skipped', message: 'AI omitted this field; requesting a second pass.' });
      publish();
    }
    async function audit() {
      update({ phase: 'Re-reading the page to verify the filled values…' });
      await new Promise(resolve => setTimeout(resolve, 400));
      for (const [binding, result] of results) if (result.status === 'filled') results.set(binding, verifyAnswer(binding));
      publish();
    }
    if (!cancelled) await audit();
    const retry = ordered.filter(b => !b.touched && !b.field.blocked && !b.field.hasValue &&
      /AI omitted|matching.*(?:dropdown|option)|match available choices|matching option|country calling code|country code does not match|another pass/i.test(results.get(b)?.message || ''));
    if (retry.length && !cancelled) {
      // Re-read current options, keeping the complete original form context.
      for (const b of retry) {
        refreshBinding(b);
        if (b.elements[0] instanceof HTMLSelectElement) b.field.options = Array.from(b.elements[0].options).filter(o => !o.disabled && o.value !== '').map(o => (o.textContent || '').trim());
      }
      await discoverComboOptions(retry, () => cancelled);
      try {
        const repaired = await ask(retry, true);
        update({ phase: 'Applying the second pass…' });
        for (const binding of retry) {
          if (cancelled) break;
          const answer = repaired.find(a => a.id === binding.field.id);
          if (answer) results.set(binding, await applyAnswer(binding, answer, () => cancelled));
          publish();
        }
        if (!cancelled) await audit();
      } catch (e) {
        notes.push({ label: 'Second pass', status: 'info', message: `${e instanceof Error ? e.message : 'Unavailable.'} Previously entered answers are retained.` });
        publish();
      }
    }
    update({ phase: cancelled ? 'Stopped — review the entered answers' : `Finished — ${state!.filled} fields entered and checked. Review all answers.`, running: false });
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Could not fill this form.';
    update({ phase: 'Could not complete AI fill', error, running: false, logs: [...state!.logs, { label: 'AI fill', status: 'error', message: error }] });
  } finally { stopWatching(); }
  return state!;
}
