// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildFormDocument } from './formDocument';
import { captureFields, applyAnswer, verifyAnswer } from './formFields';
import { buildFormPrompt } from '../lib/formPlan';
beforeEach(() => vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{ width:100,height:30 }] as unknown as DOMRectList));
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });
it('sends whole form context, including manual fields and other steps, without hidden tokens, existing values or scripts', () => {
  document.body.innerHTML = `<form action="https://example.com/private-token"><h2>Application</h2><p>List employment newest first</p>
  <label>Name<input value="EXISTING-PRIVATE-VALUE"></label><label>HKID No.<input value="PRIVATE-ID"></label>
  <input type="hidden" value="CSRF-SECRET"><script>AUTH-SECRET</script>
  <div class="wpforms-page" style="display:none"><h3>Education</h3><table><tr><th>School</th><th>Degree</th></tr><tr><td><input name="school"></td><td><input name="degree"></td></tr></table></div>
  <label><input type="checkbox">I agree to the Privacy Policy</label><button>Submit</button></form>`;
  const b = captureFields(true); const doc = buildFormDocument(b);
  expect(doc.structure).toContain('newest first'); expect(doc.structure).toContain('<table>');
  for (const f of b) expect(doc.structure).toContain(`id="${f.field.id}"`);
  for (const secret of ['PRIVATE','CSRF','SECRET','action=','<script','onclick=']) expect(doc.structure).not.toContain(secret);
  const prompt = buildFormPrompt(b.map(b => b.field), 'Alex CV', '', doc, [b[0].field.id]);
  expect(prompt.prompt).toContain('HKID No.'); expect(prompt.prompt).toContain('Education');
  expect(prompt.prompt).toContain('TARGET FIELD IDS');
});
it('rechecks earlier answers after a later widget changes them', async () => {
  document.body.innerHTML = '<label>Email<input type="email"></label>';
  const b = captureFields()[0];
  await applyAnswer(b, {id:b.field.id,value:'alex@example.com',reason:'CV'}, () => false);
  expect(verifyAnswer(b).status).toBe('filled');
  (b.elements[0] as HTMLInputElement).value = '';
  expect(verifyAnswer(b).status).toBe('skipped');
});
it('rebinds controls replaced by an ASP.NET-style update before writing later answers', async () => {
  document.body.innerHTML = '<form><label>Name<input id="name"></label><label>Year<select id="year" onchange="/* __doPostBack */"><option>2026</option><option>2004</option></select></label><label>Email<input id="email" type="email"></label></form>';
  const b=captureFields();
  const form=document.querySelector('form')!;
  document.querySelector('select')!.addEventListener('change',()=> {
    setTimeout(()=> {form.innerHTML='<label>Name<input id="name"></label><label>Year<select id="year"><option>2026</option><option selected>2004</option></select></label><label>Email<input id="email" type="email"></label>';},20);
  });
  await applyAnswer(b[0],{id:b[0].field.id,value:'Alex',reason:'CV'},()=>false);
  expect((await applyAnswer(b[1],{id:b[1].field.id,value:'2004',reason:'CV'},()=>false)).status).toBe('filled');
  expect(verifyAnswer(b[0]).status).toBe('skipped');
  expect((await applyAnswer(b[2],{id:b[2].field.id,value:'alex@example.com',reason:'CV'},()=>false)).status).toBe('filled');
  expect((document.querySelector('#email') as HTMLInputElement).value).toBe('alex@example.com');
});
