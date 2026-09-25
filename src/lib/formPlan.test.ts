import { describe, expect, it } from 'vitest';
import { parseFormPlan, buildFormPrompt, unsupportedHistory, type FormField } from './formPlan';
const fields: FormField[] = [
  { id: 'f1', label: 'Name', kind: 'text', required: true, options: [], hint: '', hasValue: false },
  { id: 'f2', label: 'Privacy', kind: 'checkbox', required: true, options: ['Agree'], hint: '', hasValue: false, blocked: 'Manual consent' },
];
describe('AI form plan validation', () => {
  it('does not infer No for missing previous-application or employee-relationship history', () => {
    expect(unsupportedHistory({ ...fields[0], label: 'Have you applied for any roles in CASETiFY in the past 12 months?' }, 'BBA student. Marketing intern.')).toBe(true);
    expect(unsupportedHistory({ ...fields[0], label: 'Are you a family member, relative or friend of any CASETiFY employee?' }, 'BBA student. Marketing intern.')).toBe(true);
    expect(unsupportedHistory({ ...fields[0], label: 'Have you applied for any roles in CASETiFY in the past 12 months?' }, 'Previous applications: None in the past 12 months.')).toBe(false);
  });
  it('rejects malformed output before any DOM write', () => {
    expect(() => parseFormPlan('javascript:document.submit()', fields)).toThrow('invalid JSON');
    expect(() => parseFormPlan('{"code":"alert(1)"}', fields)).toThrow('field/answer');
  });
  it('ignores invented IDs, duplicate answers, blocked fields and non-string data', () => {
    const plan = parseFormPlan(JSON.stringify({ answers: [{ id: 'f1', value: 'Alex Chan' }, { id: 'f1', value: 'overwrite' }, { id: 'body', value: '<script>' }, { id: 'f2', value: ['Agree'] }] }), fields);
    expect(plan.answers).toEqual([{ id: 'f1', value: 'Alex Chan', reason: '' }]);
  });
  it('treats code-like answers as data and only permits arrays for multivalue fields', () => {
    expect(parseFormPlan('{"answers":[{"id":"f1","value":["x"]}]}', fields).answers).toEqual([]);
    expect(parseFormPlan('{"answers":[{"id":"f1","value":"<script>alert(1)</script>"}]}', fields).answers[0].value).toContain('<script>');
  });
  it('includes only the supplied current-job text and structured form; no API key', () => {
    const prompt = buildFormPrompt(fields, 'Resume: Alex', 'Current job');
    expect(prompt.json).toBe(true); expect(prompt.prompt).toContain('Current job');
    expect(prompt.system).toContain('Never return code'); expect(prompt.system).toContain('Unknown answers');
  });
});

describe('facts that must not be invented from names or residence', () => {
  it('keeps the full question in context but rejects invented Chinese names, titles and nationality', async () => {
    const { missingPersonalFact, groundPersonalAnswers } = await import('./formPlan');
    const context='Alex Chun Hei Chan; Hong Kong permanent resident; no employer visa sponsorship required.';
    const chinese={...fields[0],label:'中文姓名'};
    const gender={...fields[0],label:'Gender',kind:'radio' as const,options:['Male','Female']};
    const nationality={...fields[0],label:'Nationality'};
    expect(missingPersonalFact(gender,context)).toContain('not explicitly');
    expect(missingPersonalFact(nationality,context)).toContain('not stated');
    expect(groundPersonalAnswers({answers:[{id:'f1',value:'陳子謙',reason:'Inferred'}]},[chinese],context).answers[0].value).toBe('');
    expect(groundPersonalAnswers({answers:[{id:'f1',value:'陳子謙',reason:'CV'}]},[chinese],context+' 中文姓名：陳子謙').answers[0].value).toBe('陳子謙');
    expect(missingPersonalFact(gender,'Gender: Male')).toBeUndefined();
    expect(missingPersonalFact(nationality,'Nationality: Chinese')).toBeUndefined();
  });
});
