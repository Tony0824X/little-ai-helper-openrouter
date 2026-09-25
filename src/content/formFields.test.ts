// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { captureFields, applyAnswer, discoverComboOptions, verifyAnswer } from './formFields';
beforeEach(() => {
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{ width: 100, height: 30 }] as unknown as DOMRectList);
});
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });
const answer = (id: string, value: string | string[]) => ({ id, value, reason: 'Resume fact' });
describe('generic form extraction and controlled filling', () => {
  it('ignores React select hidden validation inputs and search/filter controls', () => {
    document.body.innerHTML = '<input aria-hidden="true" required><input id="keyword-filter" aria-label="Search"><label>Country<input role="combobox" id="country"></label>';
    expect(captureFields().map(b => b.field.label)).toEqual(['Country']);
  });
  it('reads and selects a React-style listbox option, verifying its selected text', async () => {
    document.body.innerHTML = '<div class="select__control"><label for="city">Location</label><input id="city" role="combobox" aria-controls="cities"></div>';
    const input = document.querySelector('input')!;
    input.addEventListener('click', () => {
      document.querySelector('#cities')?.remove();
      const list = document.createElement('div'); list.id = 'cities'; list.setAttribute('role','listbox');
      list.innerHTML = '<div class="select__option" id="react-select-city-option-0">Hong Kong</div><div class="select__option" id="react-select-city-option-1">London</div>';
      list.firstElementChild!.addEventListener('click', () => { const selected = document.createElement('div'); selected.className = 'select__single-value'; selected.textContent = 'Hong Kong'; input.parentElement!.append(selected); list.remove(); });
      document.body.append(list);
    });
    const b = captureFields(); await discoverComboOptions(b, () => false);
    expect(b[0].field.options).toEqual(['Hong Kong','London']);
    expect((await applyAnswer(b[0], answer('f1','Hong Kong'), () => false)).status).toBe('filled');
  });
  it('honours cancellation and fields marked edited during the AI wait', async () => {
    document.body.innerHTML = '<label>Name<input></label>';
    const b = captureFields(); expect((await applyAnswer(b[0], answer('f1','Alex'), () => true)).status).toBe('skipped');
    b[0].touched = true; expect((await applyAnswer(b[0], answer('f1','Alex'), () => false)).status).toBe('skipped');
    expect(document.querySelector('input')!.value).toBe('');
  });
  it('reads nearby labels, placeholders and native select options without input values', () => {
    document.body.innerHTML = '<form><div><label>Year of Birth</label><input name="yearBirth" placeholder="YYYY" maxlength="4"></div><label>Area<select name="area"><option>Hong Kong Island</option><option>Kowloon</option></select></label><input name="email" value="private@example.com"></form>';
    const b = captureFields();
    expect(b[0].field.label).toBe('Year of Birth'); expect(b[0].field.maxLength).toBe(4);
    expect(b[1].field.options).toEqual(['Hong Kong Island', 'Kowloon']);
    expect(JSON.stringify(b.map(x => x.field))).not.toContain('private@example.com');
    expect(b[2].field.hasValue).toBe(true);
  });
  it('fills text and radio, emits change, never submits', async () => {
    document.body.innerHTML = '<form><label>Name<input name="name"></label><fieldset><legend>English proficiency?</legend><label><input type="radio" name="en" value="a">Advanced</label><label><input type="radio" name="en" value="b">Beginner</label></fieldset><button>Submit</button></form>';
    const submit = vi.fn(); document.querySelector('form')!.addEventListener('submit', submit);
    const changed = vi.fn(); document.addEventListener('change', changed, { once: true });
    const b = captureFields();
    expect((await applyAnswer(b[0], answer('f1', 'Alex Chan'), () => false)).status).toBe('filled');
    expect((await applyAnswer(b[1], answer('f2', 'Advanced'), () => false)).status).toBe('filled');
    expect(document.querySelector('input[type="radio"]')!.matches(':checked')).toBe(true);
    expect(changed).toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
  });
  it('handles checkbox groups and label-based dependent selections', async () => {
    document.body.innerHTML = '<form><div><input type="checkbox" name="work" value="1"><label>Full Time</label><input type="checkbox" name="work" value="2"><label>Part Time</label></div><select name="area"><option value="1">Hong Kong Island</option><option value="2">Kowloon</option></select><select name="district"><option value="3">Central</option></select></form>';
    const b = captureFields();
    document.querySelector('[name="area"]')!.addEventListener('change', () => { document.querySelector('[name="district"]')!.innerHTML = '<option value="9">Sham Shui Po</option>'; });
    expect((await applyAnswer(b[0], answer('f1', ['Full Time','Part Time']), () => false)).status).toBe('filled');
    expect((await applyAnswer(b[1], answer('f2', 'Kowloon'), () => false)).status).toBe('filled');
    expect((await applyAnswer(b[2], answer('f3', 'Sham Shui Po'), () => false)).status).toBe('filled');
  });
  it('accepts harmless hyphen/array-format variation only for known checkbox choices', async () => {
    document.body.innerHTML = '<label><input type="checkbox" name="work" value="1">Full Time</label><label><input type="checkbox" name="work" value="2">Part Time</label>';
    const b = captureFields();
    expect((await applyAnswer(b[0], answer('f1','Full-time and Part-time'), () => false)).status).toBe('filled');
    expect(document.querySelectorAll('input:checked').length).toBe(2);
  });
  it('finds malformed checkbox labels beyond a custom indicator wrapper', () => {
    document.body.innerHTML = '<div class="item"><span class="custom"><input type="checkbox" name="work" value="1"><i></i></span><label for="wrong-id">Full Time</label></div><div class="item"><span class="custom"><input type="checkbox" name="work" value="2"><i></i></span><label for="wrong-id-2">Part Time</label></div>';
    expect(captureFields()[0].field.options).toEqual(['Full Time','Part Time']);
  });
  it('blocks privacy consent and identity documents, preserves edited answers', async () => {
    document.body.innerHTML = '<form><label>Name<input name="name"></label><label>HKID Number<input name="hkid"></label><label><input type="checkbox" name="consent">I agree to the Privacy Policy</label></form>';
    const b = captureFields(); expect(b[1].field.blocked).toContain('Identity'); expect(b[2].field.blocked).toContain('Review');
    (b[0].elements[0] as HTMLInputElement).value = 'User edited';
    expect((await applyAnswer(b[0], answer('f1', 'AI answer'), () => false)).status).toBe('skipped');
    expect((b[0].elements[0] as HTMLInputElement).value).toBe('User edited');
  });
  it('rejects invalid formats and missing options without corrupting fields', async () => {
    document.body.innerHTML = '<form><input type="email" name="email"><select name="choice"><option>A</option><option>B</option></select></form>';
    const b = captureFields();
    expect((await applyAnswer(b[0], answer('f1', 'bad-email'), () => false)).status).toBe('skipped');
    expect((b[0].elements[0] as HTMLInputElement).value).toBe('');
    expect((await applyAnswer(b[1], answer('f2', 'Invented'), () => false)).status).toBe('skipped');
  });
  it('never treats HTML from a model as executable code', async () => {
    document.body.innerHTML = '<label>Answer<textarea></textarea></label>';
    const b = captureFields(); await applyAnswer(b[0], answer('f1', '<img src=x onerror=alert(1)>'), () => false);
    expect(document.querySelector('img')).toBeNull(); expect(document.querySelector('textarea')!.value).toContain('<img');
  });
});

describe('whole form regressions from Hong Kong application forms', () => {
  it('keeps NTK names, nationality and email eligible beside passport instructions', () => {
    document.body.innerHTML = `<form><div class="wpforms-field-layout">
      <div class="wpforms-field"><label for="surname">Surname *</label><input id="surname"><div>(As shown on HKID/ Passport)</div></div>
      <div class="wpforms-field"><label for="given">Given Names *</label><input id="given"><div>(As shown on HKID/ Passport)</div></div>
      <div class="wpforms-field"><label for="id">HKID No. / Passport No.</label><input id="id"></div>
      <div class="wpforms-field"><label for="nation">Nationality</label><input id="nation"><div>(As shown on passport)</div></div>
      </div><label>Email Address<input type="email"></label></form>`;
    const b = captureFields();
    expect(b.map(x => !!x.field.blocked)).toEqual([false,false,true,false,false]);
  });
  it('keeps the Chinese table header, row number, date direction and language group', () => {
    document.body.innerHTML = `<form><section><h3>工作經驗</h3><table><tr><th>公司/機構名稱</th><th>任職日期（年／月）由 至</th></tr>
      <tr><td><input name="company0"></td><td><select name="ddlfrom_year"><option>2026</option></select></td></tr>
      <tr><td><input name="company1"></td><td><select name="ddlto_year"><option>2026</option></select></td></tr></table></section>
      <div><span>粵語</span><div><label><input type="radio" name="cantonese">良好</label><label><input type="radio" name="cantonese">一般</label></div></div></form>`;
    const b = captureFields();
    expect(b[0].field).toMatchObject({label:'公司/機構名稱',row:1,section:'工作經驗'});
    expect(b[2].field.row).toBe(2);
    expect(b[1].field.label).toContain('from_year');
    expect(b[4].field.label).toBe('粵語');
  });
  it('includes loaded future steps as inactive context without making them fillable', async () => {
    document.body.innerHTML = '<form><div class="wpforms-page"><label>Name<input></label></div><div class="wpforms-page" style="display:none"><h3>Education</h3><label>School<input></label></div></form>';
    expect(captureFields()).toHaveLength(1);
    const b = captureFields(true); expect(b).toHaveLength(2);
    expect(b[1].field).toMatchObject({visible:false,section:'Education'});
    expect((await applyAnswer(b[1], answer(b[1].field.id,'HKBU'), () => false)).status).toBe('skipped');
  });
  it('discovers a separate phone country control, selects Hong Kong, then fills a local number', async () => {
    document.body.innerHTML = `<form><label for="mobile">Mobile Telephone No.</label><div class="iti"><button type="button" class="iti__selected-country" title="Japan: +81" aria-owns="phone-countries"><span class="iti__flag iti__jp"></span></button><input id="mobile" type="tel" maxlength="8"></div><ul id="phone-countries" class="iti__country-list"><li data-country-code="jp" data-dial-code="81">Japan +81</li><li data-country-code="hk" data-dial-code="852">Hong Kong +852</li></ul></form>`;
    const country = document.querySelector('button')!;
    document.querySelector('[data-country-code="hk"]')!.addEventListener('click', () => { country.title = 'Hong Kong: +852'; country.innerHTML = '<span class="iti__flag iti__hk"></span>'; });
    const b = captureFields(); expect(b[0].field.kind).toBe('phone-country');
    await discoverComboOptions(b, () => false);
    expect(b[0].field.options).toContain('Hong Kong +852');
    expect((await applyAnswer(b[0], answer(b[0].field.id,'Hong Kong +852'), () => false)).status).toBe('filled');
    expect((await applyAnswer(b[1], answer(b[1].field.id,'+85251510000'), () => false)).status).toBe('filled');
    expect(document.querySelector('input')!.value).toBe('51510000');
    expect(verifyAnswer(b[1]).status).toBe('filled');
    country.title = 'Japan: +81';
    expect(verifyAnswer(b[1]).status).toBe('skipped');
  });
  it('does not count a number paired with the wrong calling code as filled', async () => {
    document.body.innerHTML = '<div class="iti"><button type="button" class="iti__selected-country" title="Japan: +81"></button><input type="tel" aria-label="Mobile"></div>';
    const b = captureFields();
    const result = await applyAnswer(b[1], answer(b[1].field.id,'+85251510000'), () => false);
    expect(result.status).toBe('skipped'); expect(result.message).toContain('country code');
    expect(document.querySelector('input')!.value).toBe('');
    const localOnly = await applyAnswer(b[1], answer(b[1].field.id,'51510000'), () => false);
    expect(localOnly.status).toBe('skipped'); expect(localOnly.message).toContain('country calling code');
  });
});
