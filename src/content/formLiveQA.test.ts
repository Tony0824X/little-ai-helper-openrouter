// @vitest-environment jsdom
// Optional developer integration run against downloaded PUBLIC form HTML.
// LAH_FORM_QA=1 runs extraction; LAH_QA_KEY additionally uses real OpenRouter.
// Fixtures and synthetic applicant text live outside the shipped extension.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { captureFields, applyAnswer, verifyAnswer } from './formFields';
import { buildFormDocument } from './formDocument';
import { buildFormPrompt, parseFormPlan, missingPersonalFact, groundPersonalAnswers, type FormAnswer } from '../lib/formPlan';
import { OpenRouterProvider } from '../lib/ai/openrouter';
const root = resolve(process.cwd(), '../whole-form-qa');
describe.skipIf(!process.env.LAH_FORM_QA)('public Hong Kong form integration', () => {
  for (const site of ['sunflower','ntk','lee']) it.skipIf(!existsSync(resolve(root, `${site}.html`)))(site, async () => {
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{width:100,height:30}] as unknown as DOMRectList);
    document.documentElement.innerHTML = readFileSync(resolve(root, `${site}.html`), 'utf8');
    // Static DOM fixture: emulate UpdatePanel's server refresh in unit tests
    // separately; do not execute server postbacks in this no-network fixture.
    document.querySelectorAll('[onchange]').forEach(el => el.removeAttribute('onchange'));
    const bindings = captureFields(true);
    const fields = bindings.map(b => b.field);
    const form = buildFormDocument(bindings);
    const targets = bindings.filter(b => b.field.visible && !b.field.blocked && !b.field.hasValue);
    const context = readFileSync(resolve(root, 'demo-context.txt'),'utf8');
    for (const f of fields) f.blocked ||= missingPersonalFact(f, context);
    writeFileSync(resolve(root, `${site}-request.json`), JSON.stringify({fields,document:form,targetIds:targets.map(b=>b.field.id)},null,2));
    console.log(JSON.stringify({site,fields:fields.length,visible:fields.filter(f=>f.visible).length,targets:targets.length,formChars:form.structure.length}));
    expect(bindings.length).toBeGreaterThan(5);
    if (site === 'ntk') {
      for (const name of ['Surname','Given Names','Email Address','Residential Address']) {
        const f = fields.find(f=>f.label.replace(/\s*\*/g,'')===name);
        expect(f?.visible, name).toBe(true); expect(f?.blocked, name).toBeUndefined();
      }
    }
    if (process.env.LAH_QA_KEY) {
      const provider = new OpenRouterProvider(process.env.LAH_QA_KEY);
      const answers: FormAnswer[] = [];
      for (let offset=0; offset<targets.length; offset+=60) {
        const batch=targets.slice(offset,offset+60);
        const raw=await provider.generate(buildFormPrompt(fields,context,'',form,batch.map(b=>b.field.id)));
        answers.push(...groundPersonalAnswers(parseFormPlan(raw,batch.map(b=>b.field)),fields,context).answers);
      }
      const results=[];
      for (const b of targets) {
        const answer=answers.find(a=>a.id===b.field.id);
        const result=answer ? await applyAnswer(b,answer,()=>false) : {status:'missing',message:'AI omitted field'};
        results.push({id:b.field.id,label:b.field.label,section:b.field.section,row:b.field.row,answer,result,verified:result.status==='filled'?verifyAnswer(b):undefined});
      }
      writeFileSync(resolve(root,`${site}-result.json`),JSON.stringify(results,null,2));
      console.log(JSON.stringify({site,returned:answers.length,filled:results.filter(r=>r.verified?.status==='filled').length}));
      if (site==='ntk') {
        expect((document.querySelector('#wpforms-13005-field_242') as HTMLInputElement).value).toBe('Chan');
        expect((document.querySelector('#wpforms-13005-field_243') as HTMLInputElement).value).toBe('Alex Chun Hei');
        expect((document.querySelector('#wpforms-13005-field_2') as HTMLInputElement).value).toBe('alex.chan.demo@example.com');
      }
    }
    vi.restoreAllMocks();
  },240000);
});
