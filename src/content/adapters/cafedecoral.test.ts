import { afterEach, describe, expect, it, vi } from 'vitest';
import { cafedecoralAdapter } from './cafedecoral';
import { DEFAULT_PROFILE } from '../../lib/profile';

afterEach(() => vi.unstubAllGlobals());

describe('Café de Coral application form', () => {
  it('only enables filling on the company application route', () => {
    expect(cafedecoralAdapter.matches(new URL('https://careers.cafedecoral.com/eng/main/join-us/application-form?jid=448'))).toBe(true);
    expect(cafedecoralAdapter.matches(new URL('https://careers.cafedecoral.com/eng/main/our-people/'))).toBe(false);
    expect(cafedecoralAdapter.matches(new URL('https://careers.cafedecoral.com.example.org/eng/main/join-us/application-form'))).toBe(false);
  });

  it('fills only known facts, preserves existing input, and converts a HK phone prefix', () => {
    class Input {
      private text = '';
      disabled = false;
      readOnly = false;
      get value() { return this.text; }
      set value(value: string) { this.text = value; }
      getClientRects() { return [{}]; }
      dispatchEvent = vi.fn();
    }
    vi.stubGlobal('HTMLInputElement', Input);
    vi.stubGlobal('HTMLTextAreaElement', class {});
    // Names from the real public application form, including fields the
    // extension must never infer from the expected salary or resume text.
    const fields = Object.fromEntries(['name', 'EMail', 'contactNum', 'currentPosition', 'expectedSalary', 'currentSalary', 'yearBirth', 'hkid', 'yearsRe'].map((name) => [name, new Input()]));
    fields.name.value = 'Existing applicant name';
    vi.stubGlobal('document', { querySelector: () => ({ querySelector: (selector: string) => fields[selector.match(/name="([^"]+)"/)![1]] }) });
    const profile = { ...DEFAULT_PROFILE, personal: { ...DEFAULT_PROFILE.personal, firstName: 'Test', lastName: 'Applicant', email: 'example@example.test', phone: '+852 9123 4567' }, preferences: { ...DEFAULT_PROFILE.preferences, salaryExpectation: '25000' } };
    const result = cafedecoralAdapter.fill!(profile);
    expect(result).toEqual({ filled: 3, total: 4, alreadyFilled: 1 });
    expect(fields.name.value).toBe('Existing applicant name');
    expect(fields.EMail.value).toBe('example@example.test');
    expect(fields.contactNum.value).toBe('91234567');
    expect(fields.expectedSalary.value).toBe('25000');
    for (const name of ['currentSalary', 'yearBirth', 'hkid', 'yearsRe']) expect(fields[name].value).toBe('');
    fields.contactNum.value = '';
    cafedecoralAdapter.fill!({ ...profile, personal: { ...profile.personal, phone: '+1 415 555 0123' } });
    expect(fields.contactNum.value).toBe('');
  });
});
