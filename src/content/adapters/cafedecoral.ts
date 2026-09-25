import type { SiteAdapter } from './types';
import { textOf } from './types';
import { fillInput } from './shared';

/** The company's form has adjacent labels without for/id associations. Use
 * its exact input names; leave birth year, HKID, past salary and choices alone.
 */
export const cafedecoralAdapter: SiteAdapter = {
  id: 'cafedecoral',
  matches: (url) => url.hostname === 'careers.cafedecoral.com' && /^\/(eng|tc|sc)\/main\/join-us\/application-form\/?$/.test(url.pathname),
  getPageInfo: () => ({ company: 'Café de Coral', role: textOf(['#applicationForm h3', '#applicationForm h2']) }),
  fill(profile) {
    const form = document.querySelector('#applicationForm');
    const summary = { filled: 0, total: 0, alreadyFilled: 0 };
    if (!form) return summary;
    const digits = profile.personal.phone.replace(/\D/g, '').replace(/^(?:00852|852)(?=\d{8}$)/, '');
    const values: Record<string, string> = {
      name: `${profile.personal.firstName} ${profile.personal.lastName}`.trim(),
      EMail: profile.personal.email,
      contactNum: /^\d{8}$/.test(digits) ? digits : '',
      currentPosition: profile.workHistory[0]?.title ?? '',
      expectedSalary: profile.preferences.salaryExpectation,
    };
    for (const [name, value] of Object.entries(values)) {
      const field = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      if (!value || !field || field.disabled || field.readOnly || !field.getClientRects().length) continue;
      summary.total++;
      if (field.value.trim()) { summary.alreadyFilled++; continue; }
      fillInput(field, value);
      summary.filled++;
    }
    return summary;
  },
};
