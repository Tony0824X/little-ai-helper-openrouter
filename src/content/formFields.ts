import { fillInput } from './adapters/shared';
import { FORM_LIMIT, type FormField, type FormAnswer, type FillLog } from '../lib/formPlan';

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement;
export interface FieldBinding { field: FormField; elements: Control[]; original: string; touched: boolean; applied?: string; appliedDial?: string; anchors?: { id: string; name: string; value: string }[] }
const controlSelector = 'input, textarea, select, [role="combobox"], [contenteditable="true"], .iti__selected-country, .iti__selected-flag, .intl-tel-input .selected-flag, button[aria-haspopup="listbox"]';
const clean = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();
const norm = (s: string) => clean(s).toLowerCase().replace(/[＊*]/g, '').replace(/[-‐‑–—]/g, ' ').replace(/\s+/g, ' ').trim();
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function visible(el: Element): boolean {
  if (!el.getClientRects().length) return false;
  for (let p: Element | null = el; p; p = p.parentElement) {
    if (p.hasAttribute('hidden') || getComputedStyle(p).display === 'none' || getComputedStyle(p).visibility === 'hidden') return false;
  }
  return true;
}
function controlVisible(el: Element): boolean {
  if (visible(el)) return true;
  if (el instanceof HTMLInputElement && /radio|checkbox/.test(el.type)) {
    return Array.from(el.labels || []).some(visible);
  }
  // select2/Chosen keep a real <select> hidden beside their visible widget.
  return el instanceof HTMLSelectElement && !!el.parentElement && visible(el.parentElement) &&
    !!el.parentElement.querySelector('.select2-container, .chosen-container, .selectric-wrapper, .nice-select');
}
function textWithoutControls(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll('input,textarea,select,script,style,button,[contenteditable]').forEach(n => n.remove());
  return clean(copy.textContent);
}
const fieldContainer = '.wpforms-field:not(.wpforms-field-layout), .wsite-form-field, .form-group, .application-question, fieldset';
const stepSelector = '.wpforms-page, [role="tabpanel"], [data-step]';
const countrySelector = '.iti__selected-country, .iti__selected-flag, .intl-tel-input .selected-flag';

function tableContext(el: Element): { label: string; row?: number } {
  let cell = el.closest('td,th');
  // Legacy ASP.NET forms nest layout tables inside a data-table cell. Walk out
  // until the actual row/column question is found, rather than using row order.
  for (let depth = 0; cell && depth < 8; depth++) {
    const table = cell.closest('table');
    const row = cell.closest('tr');
    if (!table || !row) break;
    const previous = cell.previousElementSibling;
    if (previous && !previous.querySelector(controlSelector)) {
      const inline = textWithoutControls(previous);
      if (inline && inline.length < 200) return { label: inline };
    }
    const rows = Array.from(table.rows);
    const header = rows.find(r => !r.querySelector(controlSelector) && r.cells.length > 1);
    const col = Array.from(row.cells).indexOf(cell as HTMLTableCellElement);
    if (header && header !== row) {
      const dataRows = rows.filter(r => !!r.querySelector(controlSelector));
      return { label: textWithoutControls(header.cells[col] || header), row: dataRows.indexOf(row) + 1 || undefined };
    }
    cell = table.parentElement?.closest('td,th') || null;
  }
  return { label: '' };
}
function groupQuestion(el: Control): string {
  const container = el.closest(fieldContainer);
  const heading = container?.querySelector(':scope > label, :scope > legend, :scope > .field-label');
  if (heading && !heading.contains(el)) return textWithoutControls(heading);
  for (let p = el.parentElement, depth = 0; p && depth < 5 && !p.matches('form,body'); p = p.parentElement, depth++) {
    const prev = p.previousElementSibling;
    if (prev && !prev.querySelector(controlSelector)) {
      const t = textWithoutControls(prev);
      if (t && t.length < 250) return t;
    }
  }
  return '';
}
function labels(el: Control): string {
  if (el.matches(countrySelector)) {
    const phone = el.closest('.iti, .intl-tel-input')?.querySelector('input[type="tel"]');
    return `${phone ? labels(phone as Control) : 'Phone'} — country calling code`;
  }
  const linked = (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ');
  const native = 'labels' in el ? Array.from(el.labels || []).map(l => textWithoutControls(l)).join(' ') : '';
  const grouped = el instanceof HTMLInputElement && /radio|checkbox/.test(el.type);
  const table = tableContext(el);
  let label = clean((grouped && groupQuestion(el)) || native || linked || el.getAttribute('aria-label') || table.label);
  if (!label) {
    for (let parent = el.parentElement, depth = 0; parent && depth < 4; parent = parent.parentElement, depth++) {
      const heading = parent.querySelector(':scope > label, :scope > legend, :scope > .application-label, :scope > .label, :scope > .field-label');
      if (heading) { label = textWithoutControls(heading); break; }
      const prev = parent.previousElementSibling;
      if (prev && !prev.querySelector(controlSelector)) {
        const t = textWithoutControls(prev);
        if (t && t.length < 180) { label = t; break; }
      }
    }
  }
  const base = label || el.getAttribute('placeholder') || table.label || el.getAttribute('name') || el.id || 'Unlabelled field';
  const datePart = `${el.getAttribute('name')} ${el.id}`.match(/(?:from|to)[_-](?:year|month)|(?:year|month|day)$/i)?.[0];
  return clean(`${base}${datePart ? ` (${datePart})` : ''}`).slice(0, 250);
}
function sectionOf(el: Control): string {
  const step = el.closest(stepSelector);
  const stepHeading = step?.querySelector('h1,h2,h3,h4,legend');
  for (let p = el.parentElement, depth = 0; p && depth < 24 && !p.matches('form,body'); p = p.parentElement, depth++) {
    const heading = p.querySelector(':scope > h2,:scope > h3,:scope > h4,:scope > legend,:scope > .title,:scope > .section-title');
    if (heading) return clean(`${stepHeading ? textWithoutControls(stepHeading) : ''} ${textWithoutControls(heading)}`);
    const prev = p.previousElementSibling;
    if (prev && !prev.matches('tr,td,th') && !prev.querySelector(controlSelector)) {
      const text = textWithoutControls(prev);
      if (text.length > 1 && text.length < 200 && /experience|education|employment|personal|language|工作|學歷|語言|個人|任職/i.test(text)) return text;
    }
  }
  return stepHeading ? textWithoutControls(stepHeading) : '';
}
function hint(el: Control): string {
  const parts = [el.getAttribute('name'), el.getAttribute('placeholder'), el.getAttribute('data-placeholder'), el.getAttribute('autocomplete'), el.getAttribute('data-date-format')];
  for (const id of (el.getAttribute('aria-describedby') || '').split(/\s+/)) parts.push(document.getElementById(id)?.textContent || '');
  const container = el.closest(fieldContainer);
  if (container) parts.push(textWithoutControls(container).slice(0, 500));
  parts.push(tableContext(el).label);
  const prev = el.previousElementSibling;
  if (prev && !prev.querySelector(controlSelector)) parts.push(textWithoutControls(prev));
  return [...new Set(parts.filter(Boolean).map(s => clean(s)))].join(' | ').slice(0, 650);
}
function optionLabel(el: Control): string {
  const sibling = el.nextElementSibling;
  let nearby = '';
  for (let parent = el.parentElement, depth = 0; parent && depth < 3; parent = parent.parentElement, depth++) {
    if (parent.querySelectorAll('input').length > 1) break;
    const label = parent.querySelector('label, .application-answer-alternative');
    if (label) { nearby = textWithoutControls(label); break; }
  }
  return clean(('labels' in el && el.labels?.length ? Array.from(el.labels).map(l => textWithoutControls(l)).join(' ') : '') ||
    (sibling?.matches('label,span') ? sibling.textContent : '') || nearby || el.getAttribute('aria-label') || el.getAttribute('value') || 'Yes');
}
function comboWrapper(el: Control): Element {
  return el.closest('[class*="__control"], .select__control, .select-shell, [data-slot="select-trigger"]') || el.parentElement || el;
}
function valueOf(elements: Control[], kind: FormField['kind']): string {
  if (kind === 'radio' || kind === 'checkbox') return elements.filter(e => (e as HTMLInputElement).checked).map(e => (e as HTMLInputElement).value).join('\n');
  const el = elements[0];
  if (kind === 'phone-country') return clean(el.getAttribute('title') || el.getAttribute('aria-label') || el.textContent);
  if (kind === 'combobox') {
    const selected = comboWrapper(el).querySelector('[class*="single-value"], [class*="singleValue"], [class*="multi-value"], [class*="multiValue"]');
    if (selected) return clean(selected.textContent);
  }
  return 'value' in el ? String(el.value) : clean(el.textContent);
}
function blockedReason(field: FormField): string | undefined {
  // Only the actual question determines a manual-only field. Nearby descriptions
  // like 'name as shown on passport' must never block ordinary contact details.
  const text = field.label;
  if (field.kind === 'file') return 'Attach your CV file manually.';
  if (/captcha|verification code|one.time.password|信用卡|credit.card|bank.account|password/i.test(text)) return 'Security or payment field: fill manually.';
  if (/\b(hk[.\s-]*i[.\s-]*d|social.security|ssn|identity.card)\b|passport.{0,12}(?:no\b|number)|身份證|身份证/i.test(text) && !/name|姓名|姓氏|國籍|nationality/i.test(text)) return 'Identity document: fill manually.';
  if (/consent|privacy.policy|terms.{0,20}(service|use|conditions)|\bagree\b|\bcertify\b|declaration|私隱|聲明|同意/i.test(text)) return 'Review and confirm this declaration yourself.';
  return undefined;
}

export function captureFields(includeInactive = false): FieldBinding[] {
  const root = document.querySelector('#application-form, #application_form, form[action*="apply"], form[name="application"]') || document;
  const all = Array.from(root.querySelectorAll<Control>(controlSelector)).filter(el => {
    if (el.closest('[data-lah-ui], nav, header, footer, [role="search"]')) return false;
    if (el.closest('[aria-hidden="true"]') && !(el instanceof HTMLSelectElement && controlVisible(el))) return false;
    // These accessible facade widgets are backed by a real select below.
    // Capture the native control once; changing it updates Select2/Chosen.
    if (!(el instanceof HTMLSelectElement) && el.closest('.select2-container, .chosen-container')) return false;
    if (el instanceof HTMLInputElement && /^(hidden|submit|button|reset|image|password|search)$/.test(el.type)) return false;
    if (el instanceof HTMLButtonElement && el.type !== 'button') return false;
    if (el.matches(countrySelector) && el.parentElement?.closest(countrySelector)) return false;
    if ('disabled' in el && el.disabled) return false;
    if ('readOnly' in el && el.readOnly && !el.matches('[role="combobox"], .flatpickr-input, .wpforms-datepicker, [data-date-format]')) return false;
    if (/search|keyword.filter|department.filter|office.filter/i.test(`${el.id} ${el.getAttribute('name')} ${el.getAttribute('aria-label')}`)) return false;
    if (el instanceof HTMLInputElement && el.type === 'file') return !!el.closest('form');
    return controlVisible(el) || (includeInactive && !!el.closest(stepSelector) && !!el.closest('form'));
  });
  const seen = new Set<Control>();
  const bindings: FieldBinding[] = [];
  for (const el of all) {
    if (seen.has(el)) continue;
    let kind: FormField['kind'] = 'text';
    if (el instanceof HTMLSelectElement) kind = el.multiple ? 'multiselect' : 'select';
    else if (el instanceof HTMLTextAreaElement || el.isContentEditable) kind = 'textarea';
    else if (el.matches(countrySelector)) kind = 'phone-country';
    else if (el.matches('button[aria-haspopup="listbox"]')) kind = 'combobox';
    else if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete') === 'list') kind = 'combobox';
    else if (el instanceof HTMLInputElement && ['email','tel','number','date','radio','checkbox','file'].includes(el.type)) kind = el.type as FormField['kind'];
    const grouped = kind === 'radio' || kind === 'checkbox';
    const elements = grouped && el.getAttribute('name') ? all.filter(n => n instanceof HTMLInputElement && n.type === kind && n.name === el.getAttribute('name') && n.form === (el as HTMLInputElement).form) : [el];
    elements.forEach(n => seen.add(n));
    const original = valueOf(elements, kind);
    const options = el instanceof HTMLSelectElement ? Array.from(el.options).filter(o => !o.disabled && o.value !== '').map(o => clean(o.textContent)) : grouped ? elements.map(optionLabel) : [];
    const field: FormField = {
      id: `f${bindings.length + 1}`, label: labels(el), kind,
      required: elements.some(e => e.hasAttribute('required') || e.getAttribute('aria-required') === 'true' || e.classList.contains('required')),
      options: options.slice(0, 300), hint: hint(el),
      section: sectionOf(el), row: tableContext(el).row, visible: controlVisible(el),
      // Native selects usually ship with a default option. Only preserve a
      // non-default selection (or a field changed by the user while we work).
      hasValue: kind === 'phone-country' ? false : kind === 'select' ? (el as HTMLSelectElement).selectedIndex > 0 && !Array.from((el as HTMLSelectElement).options).some(o => o.defaultSelected && o.selected) : !!original,
    };
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (el.maxLength > 0) field.maxLength = el.maxLength;
      if (el instanceof HTMLInputElement) field.hint += ` ${clean([el.min && `min=${el.min}`, el.max && `max=${el.max}`, el.pattern && `pattern=${el.pattern}`].filter(Boolean).join(' '))}`;
    }
    if (kind === 'tel' && el.closest('.iti, .intl-tel-input')?.querySelector(countrySelector)) field.hint += ' International phone widget: return the full number with +country calling code. The extension verifies the separate country selector, then strips the code before applying the local length limit.';
    field.blocked = blockedReason(field);
    bindings.push({ field, elements, original, touched: false, anchors: elements.map(e => ({id:e.id,name:e.getAttribute('name') || '',value:e.getAttribute('value') || ''})) });
    if (bindings.length > FORM_LIMIT) throw new Error(`This form has more than ${FORM_LIMIT} fields. No partial form was sent; use a smaller section.`);
  }
  return bindings;
}

function listOptions(el: Control): HTMLElement[] {
  const ids = `${el.getAttribute('aria-controls') || ''} ${el.getAttribute('aria-owns') || ''}`.trim().split(/\s+/).filter(Boolean);
  const lists = ids.map(id => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
  if (!lists.length) lists.push(...Array.from(document.querySelectorAll<HTMLElement>('[role="listbox"]')).filter(visible));
  return lists.flatMap(l => Array.from(l.querySelectorAll<HTMLElement>('[role="option"], .select__option, [id^="react-select-"][id*="-option-"]'))).filter(e => visible(e) && e.getAttribute('aria-disabled') !== 'true');
}
function openCombo(el: Control): void {
  el.focus();
  // React-select opens on mousedown; HTMLElement.click() alone omits it.
  if (el.getAttribute('aria-expanded') !== 'true') {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
    el.click();
  }
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true }));
}
function closeCombo(el: Control): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
  el.blur();
  el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
}
function countryList(el: Control): HTMLElement[] {
  const wrapper = el.closest('.iti, .intl-tel-input');
  const id = el.getAttribute('aria-controls') || el.getAttribute('aria-owns') || el.querySelector('[aria-controls]')?.getAttribute('aria-controls') || el.querySelector('[aria-owns]')?.getAttribute('aria-owns');
  const list = id ? document.getElementById(id) : wrapper;
  return Array.from((list || wrapper || el).querySelectorAll<HTMLElement>('[data-country-code], [data-dial-code]')).filter(n => n.matches('li,[role="option"]'));
}
function countryName(el: HTMLElement): string {
  const name = clean(el.querySelector('.iti__country-name, .country-name')?.textContent || el.textContent);
  const dial = el.getAttribute('data-dial-code');
  return dial && !name.includes(`+${dial}`) ? `${name} +${dial}` : name;
}
function selectedDial(el: Control): string {
  const wrapper = el.closest('.iti, .intl-tel-input');
  const title = `${el.getAttribute('title') || ''} ${el.getAttribute('aria-label') || ''} ${el.textContent || ''}`;
  return title.match(/\+(\d{1,4})/)?.[1] || wrapper?.querySelector('.iti__selected-dial-code')?.textContent?.replace(/\D/g, '') || '';
}
async function discoverCountries(binding: FieldBinding): Promise<void> {
  if (!binding.field.visible) return;
  const el = binding.elements[0];
  let options = countryList(el);
  if (!options.length) {
    el.click(); await delay(160);
    options = countryList(el);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (el.getAttribute('aria-expanded') === 'true') el.click();
  }
  binding.field.options = [...new Set(options.map(countryName))];
  binding.field.hint += ' Country calling code for its adjacent phone number; select it before filling the number.';
}
async function fillCountry(binding: FieldBinding, value: string, cancelled: () => boolean): Promise<boolean> {
  const el = binding.elements[0];
  if (cancelled()) return false;
  el.click(); await delay(160);
  const options = countryList(el);
  const wantedDial = value.match(/\+(\d{1,4})/)?.[1];
  const option = pickOption(options, value, countryName) ||
    (wantedDial && options.filter(o => o.getAttribute('data-dial-code') === wantedDial).length === 1
      ? options.find(o => o.getAttribute('data-dial-code') === wantedDial) : undefined);
  if (!option || cancelled() || binding.touched) {
    if (el.getAttribute('aria-expanded') === 'true') el.click();
    return false;
  }
  option.click(); await delay(150);
  const code = option.getAttribute('data-country-code');
  const dial = option.getAttribute('data-dial-code');
  const flag = el.querySelector('.iti__flag, .flag');
  return !!((code && flag?.classList.contains(`iti__${code}`)) ||
    (code && flag?.classList.contains(code)) || (dial && selectedDial(el) === dial));
}

export async function discoverComboOptions(bindings: FieldBinding[], cancelled: () => boolean): Promise<void> {
  for (const binding of bindings) {
    if (cancelled()) return;
    if (binding.field.kind === 'phone-country') { await discoverCountries(binding); continue; }
    if (binding.field.visible === false) continue;
    if (binding.field.kind !== 'combobox' || binding.field.hasValue || binding.field.blocked) continue;
    const el = binding.elements[0];
    openCombo(el);
    for (let i = 0; i < 6 && !cancelled(); i++) {
      await delay(140);
      if (listOptions(el).length) break;
    }
    const options = [...new Set(listOptions(el).map(o => clean(o.textContent)))].slice(0, 300);
    if (options.length) binding.field.options = options;
    closeCombo(el);
  }
}

function pickOption<T>(options: T[], value: string, getText: (o: T) => string): T | undefined {
  const target = norm(value);
  const exact = options.filter(o => norm(getText(o)) === target);
  if (exact.length === 1) return exact[0];
  // Parenthesised country codes/regions are presentation, not a different city.
  const near = options.filter(o => {
    const t = norm(getText(o));
    return t.startsWith(`${target} (`) || t.startsWith(`${target},`) || t.startsWith(`${target} sar`) || target.startsWith(`${t} (`);
  });
  return near.length === 1 ? near[0] : undefined;
}

async function fillCombo(binding: FieldBinding, value: string, cancelled: () => boolean): Promise<boolean> {
  const el = binding.elements[0];
  openCombo(el); await delay(100);
  let option = pickOption(listOptions(el), value, o => clean(o.textContent));
  if (!option && el instanceof HTMLInputElement) {
    fillInput(el, value); // triggers remote location/country suggestion lookup
    for (let i = 0; i < 15 && !cancelled(); i++) {
      await delay(160);
      option = pickOption(listOptions(el), value, o => clean(o.textContent));
      if (option) break;
    }
  }
  if (cancelled() || binding.touched) { closeCombo(el); return false; }
  if (!option) {
    const suggestions = listOptions(el).map(o => clean(o.textContent));
    if (suggestions.length) binding.field.options = suggestions.slice(0, 300);
    if (el instanceof HTMLInputElement) fillInput(el, binding.original);
    closeCombo(el); return false;
  }
  const expected = clean(option.textContent);
  option.click(); await delay(150); closeCombo(el);
  const now = valueOf(binding.elements, 'combobox');
  const phoneCodeSelected = el.id === 'country' && /^\+\d+$/.test(now) && expected.endsWith(now);
  return phoneCodeSelected || norm(now) === norm(expected) || norm(now) === norm(value) || norm(now).startsWith(`${norm(value)},`);
}

export async function applyAnswer(binding: FieldBinding, answer: FormAnswer, cancelled: () => boolean): Promise<FillLog> {
  refreshBinding(binding);
  const { field, elements } = binding;
  const skip = (message: string): FillLog => ({ label: field.label, status: 'skipped', message });
  if (cancelled()) return skip('Cancelled.');
  if (field.blocked) return skip(field.blocked);
  if (field.hasValue || binding.touched) return skip('Existing or newly edited value preserved.');
  const el = elements[0];
  if (!el.isConnected || !controlVisible(el)) return skip('Field moved or disappeared; scan again.');
  // Dependencies legitimately change the defaults of select lists. User edits
  // are tracked separately with trusted events, so never overwrite those.
  if (!['select','multiselect'].includes(field.kind) && valueOf(elements, field.kind) !== binding.original) return skip('Value changed while AI was working; preserved.');
  let values = (Array.isArray(answer.value) ? answer.value : [answer.value]).map(v => v.trim()).filter(Boolean);
  if (!values.length) return skip(answer.reason || 'Not enough facts in the CV.');
  let value = values[0];
  const country = field.kind === 'tel' ? el.closest('.iti, .intl-tel-input')?.querySelector<HTMLElement>(countrySelector) : null;
  let dial: string | undefined;
  if (country) {
    if (!value.startsWith('+')) return skip('International phone answer needs its country calling code; requesting another pass.');
    dial = selectedDial(country);
    const digits = value.replace(/\D/g, '');
    if (!dial || !digits.startsWith(dial)) return skip('Phone country code does not match the AI answer; number was not entered.');
    value = digits.slice(dial.length);
  }
  if (field.maxLength && value.length > field.maxLength) return skip(`Answer exceeds this field's ${field.maxLength}-character limit.`);
  if (field.kind === 'phone-country') {
    if (!await fillCountry(binding, value, cancelled)) return skip('Could not confirm the country calling code; choose manually.');
  } else if (field.kind === 'combobox') {
    if (!await fillCombo(binding, value, cancelled)) return skip('Could not confirm a matching dropdown option; choose manually.');
  } else if (field.kind === 'radio' || field.kind === 'checkbox') {
    if (field.kind === 'checkbox' && values.length === 1 && !pickOption(elements, values[0], optionLabel)) {
      // Some models use a comma/"and" string despite the requested array. Only
      // accept it when every part independently matches a real option.
      const parts = values[0].split(/[,;\n]|\s+and\s+/i).map(v => v.trim()).filter(Boolean);
      if (parts.length > 1 && parts.every(v => pickOption(elements, v, optionLabel))) values = parts;
    }
    const targets = values.map(v => pickOption(elements, v, optionLabel));
    if (targets.some(t => !t)) return skip(`Answer does not match available choices: ${field.options.join(' / ')}.`);
    for (const target of targets) {
      if (cancelled() || binding.touched) return skip('Stopped before changing selection.');
      const input = target as HTMLInputElement;
      if (!input.checked) input.click();
    }
    if (!targets.every(t => (t as HTMLInputElement).checked)) return skip('Website did not retain the selection.');
  } else if (el instanceof HTMLSelectElement) {
    const targets = values.map(v => pickOption(Array.from(el.options).filter(o => !o.disabled), v, o => clean(o.textContent)));
    if (targets.some(t => !t)) return skip('No matching option in the current dropdown.');
    if (el.multiple) Array.from(el.options).forEach(o => { o.selected = targets.includes(o); });
    else Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(el, targets[0]!.value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (/__doPostBack/.test(el.getAttribute('onchange') || '')) {
      // ASP.NET UpdatePanel replaces nodes after a server round trip. Keep
      // later answers from being written into detached, obsolete controls.
      const deadline = Date.now() + 5000;
      while (el.isConnected && Date.now() < deadline && !cancelled()) await delay(80);
      await delay(160);
      refreshBinding(binding);
    } else await delay(120); // local dependent region/district redraw
    if (binding.elements[0] !== el) {
      const current = binding.elements[0] as HTMLSelectElement;
      if (!values.every(v => Array.from(current.selectedOptions).some(o => norm(o.textContent) === norm(v)))) return skip('Website changed the answer after filling; needs another pass.');
    }
    if (!targets.every(t => t!.selected)) return skip('Website did not retain the selection.');
  } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    // Country code is a separate widget on Greenhouse. Avoid adding it twice.
    if (field.kind === 'tel' && document.querySelector('[id="country"][role="combobox"]') && /^\+852[\s-]*\d{4}[\s-]*\d{4}$/.test(value)) value = value.replace(/^\+852/, '').replace(/\D/g, '');
    fillInput(el, value); await delay(50);
    const samePhone = /phone|mobile|contact number/i.test(field.label) && el.value.replace(/\D/g, '') === value.replace(/\D/g, '');
    if ((!samePhone && el.value !== value) || !el.validity.valid) {
      if (!binding.touched) fillInput(el, binding.original);
      return skip('Website rejected the format; original value restored.');
    }
  } else if (el.isContentEditable) {
    el.textContent = value;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  } else return skip('Unsupported widget.');
  binding.applied = valueOf(binding.elements, field.kind);
  binding.appliedDial = dial;
  return { label: field.label, status: 'filled', message: 'Entered; checking after the page updates.' };
}

export function watchUserEdits(bindings: FieldBinding[]): () => void {
  const listener = (event: Event) => {
    if (!event.isTrusted) return;
    for (const b of bindings) if (b.elements.includes(event.target as Control) || (event.target instanceof Element && b.anchors?.some(a => a.id && a.id === (event.target as Element).id))) b.touched = true;
  };
  document.addEventListener('input', listener, true);
  document.addEventListener('change', listener, true);
  return () => { document.removeEventListener('input', listener, true); document.removeEventListener('change', listener, true); };
}

/** Re-read after ALL writes so a later dependent widget cannot silently undo an
 * earlier answer. This verifies retention/format, not factual correctness. */
export function verifyAnswer(binding: FieldBinding): FillLog {
  refreshBinding(binding);
  const { field, elements } = binding;
  const el = elements[0];
  const log = (status: FillLog['status'], message: string): FillLog => ({ label: field.label, status, message });
  if (binding.touched) return log('skipped', 'You edited this field; your value is preserved.');
  if (!el.isConnected || !controlVisible(el)) return log('skipped', 'Field changed or disappeared after filling; review the current form.');
  const now = valueOf(elements, field.kind);
  const equivalent = now === binding.applied || (field.kind === 'tel' && now.replace(/\D/g, '') === binding.applied?.replace(/\D/g, ''));
  if (!equivalent) return log('skipped', 'Website changed the answer after filling; needs another pass.');
  if (binding.appliedDial) {
    const country = el.closest('.iti, .intl-tel-input')?.querySelector<HTMLElement>(countrySelector);
    if (!country || selectedDial(country) !== binding.appliedDial) return log('skipped', 'Phone country code changed after filling; needs another pass.');
  }
  if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) && !(field.kind === 'checkbox' && elements.length > 1) && !el.validity.valid) return log('skipped', 'Website reports an invalid format; review this field.');
  if (el.getAttribute('aria-invalid') === 'true') return log('skipped', 'Website validation rejected this answer.');
  return log('filled', 'Value retained and format checked; review the answer before submitting.');
}

export function refreshBinding(binding: FieldBinding): void {
  binding.elements = binding.elements.map((el, i) => {
    if (el.isConnected) return el;
    const anchor = binding.anchors?.[i];
    if (!anchor) return el;
    if (anchor.id) return document.getElementById(anchor.id) as Control || el;
    const candidates = Array.from(document.getElementsByName(anchor.name)).filter(n => n.getAttribute('value') === anchor.value);
    return candidates.length === 1 ? candidates[0] as Control : el;
  });
}
