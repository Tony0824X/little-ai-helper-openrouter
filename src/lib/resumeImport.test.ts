import { describe, it, expect } from 'vitest';
import { parseLooseJson, extractJsonObject, parseResumeJson, mergeResumeProfile } from './resumeImport';
import { DEFAULT_PROFILE } from './profile';

describe('parseLooseJson', () => {
  it('parses clean JSON', () => {
    expect(parseLooseJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips code fences', () => {
    expect(parseLooseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('ignores prose before and after the object', () => {
    expect(parseLooseJson('Sure! Here is the JSON:\n{"a":1}\nHope that helps.')).toEqual({ a: 1 });
  });

  it('recovers from an unescaped newline inside a string value', () => {
    // Invalid strict JSON (raw newline in the string) — the classic model failure.
    const raw = '{"summary":"line one\nline two"}';
    expect(() => JSON.parse(raw)).toThrow();
    expect(parseLooseJson(raw)).toEqual({ summary: 'line one line two' });
  });

  it('repairs a truncated response (cut off mid-string)', () => {
    const raw = '{"work":[{"title":"Engineer","company":"Acme","description":"Did a lot of goo';
    const out = parseLooseJson(raw) as { work: { title: string; company: string }[] };
    expect(out.work[0].title).toBe('Engineer');
    expect(out.work[0].company).toBe('Acme');
  });

  it('repairs truncation cut at a dangling key', () => {
    const raw = '{"a":1,"b":2,"c":';
    expect(parseLooseJson(raw)).toEqual({ a: 1, b: 2 });
  });

  it('returns null when nothing is parseable', () => {
    expect(parseLooseJson('no json here at all')).toBeNull();
  });
});

describe('extractJsonObject', () => {
  it('returns the balanced object and drops trailing prose', () => {
    expect(extractJsonObject('{"a":{"b":1}} trailing junk }')).toBe('{"a":{"b":1}}');
  });

  it('does not stop at a brace inside a string', () => {
    expect(extractJsonObject('{"a":"has } brace"}')).toBe('{"a":"has } brace"}');
  });

  it('keeps a literal code fence inside a string value', () => {
    const raw = JSON.stringify({ a: 'Wrote ```json examples``` for the docs.' });
    expect(extractJsonObject(raw)).toBe(raw);
  });

  it('drops an outer fence without touching a fence inside a string value', () => {
    const inner = JSON.stringify({ a: 'see ```json here```' });
    expect(extractJsonObject('```json\n' + inner + '\n```')).toBe(inner);
  });

  it('drops a dangling closing fence from a truncated response', () => {
    expect(extractJsonObject('```json\n{"a":"unterminated\n```')).toBe('{"a":"unterminated');
  });
});

describe('parseResumeJson', () => {
  it('imports the three explicit preferences and keeps salary units and conditions', () => {
    const preferences = {
      workAuthorization: 'Hong Kong permanent resident; authorised to work in Hong Kong',
      requiresSponsorship: 'No',
      salaryExpectation: 'HKD 20,000/month full-time; HKD 80/hour part-time or internship',
    };
    const parsed = parseResumeJson(JSON.stringify({ preferences }));
    expect(parsed.preferences).toEqual(preferences);
    expect(mergeResumeProfile(structuredClone(DEFAULT_PROFILE), parsed).preferences).toMatchObject(preferences);
  });

  it('keeps missing preferences absent rather than assuming sponsorship is No', () => {
    expect(parseResumeJson('{"personal":{"country":"Hong Kong"}}').preferences).toEqual({});
    expect(parseResumeJson('{"preferences":{"requiresSponsorship":"unknown","salaryExpectation":20000}}').preferences).toEqual({});
  });

  it('normalizes an explicit boolean false without dropping it', () => {
    expect(parseResumeJson('{"preferences":{"requiresSponsorship":false}}').preferences.requiresSponsorship).toBe('No');
    expect(parseResumeJson('{"preferences":{"requiresSponsorship":" yes "}}').preferences.requiresSponsorship).toBe('Yes');
  });

  it('preserves existing preferences when the new CV has no relevant facts', () => {
    const current = structuredClone(DEFAULT_PROFILE);
    current.preferences.salaryExpectation = 'HKD 25,000/month';
    current.preferences.requiresSponsorship = 'Yes';
    const merged = mergeResumeProfile(current, parseResumeJson('{"preferences":{"salaryExpectation":""}}'));
    expect(merged.preferences).toEqual(current.preferences);
  });

  it('preserves preference edits made while the import was waiting', () => {
    const startedFrom = structuredClone(DEFAULT_PROFILE);
    const current = structuredClone(startedFrom);
    current.preferences.salaryExpectation = 'HKD 30,000/month';
    const parsed = parseResumeJson('{"preferences":{"salaryExpectation":"HKD 20,000/month","requiresSponsorship":"No"}}');
    const merged = mergeResumeProfile(current, parsed, startedFrom);
    expect(merged.preferences.salaryExpectation).toBe('HKD 30,000/month');
    expect(merged.preferences.requiresSponsorship).toBe('No');
  });

  it('does not import demographic preferences from the AI response', () => {
    const parsed = parseResumeJson('{"preferences":{"gender":"Male","ethnicity":"Asian","requiresSponsorship":"No"}}');
    expect(parsed.preferences).toEqual({ requiresSponsorship: 'No' });
  });

  it('maps a truncated resume response to partial data instead of throwing', () => {
    const raw =
      '{"personal":{"firstName":"Ada","lastName":"Lovelace","email":"ada@x.com"},' +
      '"work":[{"title":"Engineer","company":"Acme","startDate":"2020","endDate":"present","descrip';
    const parsed = parseResumeJson(raw);
    expect(parsed.personal.firstName).toBe('Ada');
    expect(parsed.work[0].company).toBe('Acme');
  });

  it('preserves a Markdown example quoted in a work description', () => {
    const description = 'Wrote ```json examples``` for the API documentation.';
    const raw = JSON.stringify({ work: [{ title: 'Engineer', description }] });
    expect(parseResumeJson(raw).work[0].description).toBe(description);
  });
});
