// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { runAiFill } from './aiFill';
import { sendToBackground } from '../lib/messages';

vi.mock('../lib/messages', () => ({ sendToBackground: vi.fn() }));
vi.mock('./sponsorship', () => ({ getScanText: () => 'Test job' }));
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('sends the complete form in each answer batch and fills only eligible current-step fields', async () => {
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{ width:100,height:30 }] as unknown as DOMRectList);
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) } });
  document.body.innerHTML = `<form><h2>Application</h2>${Array.from({length:61}, (_, i) => `<label>Question ${i}<input id="q${i}"></label>`).join('')}
    <label>Existing answer<input id="existing" value="Keep my answer"></label>
    <label><input type="checkbox" id="consent">I agree to the Privacy Policy</label>
    <div class="wpforms-page" style="display:none"><h3>Education</h3><label>School<input id="school"></label></div><button>Submit</button></form>`;
  const submitted = vi.fn(); document.querySelector('form')!.addEventListener('submit', submitted);
  vi.mocked(sendToBackground).mockImplementation(async msg => {
    if (msg.type !== 'AI_FILL_FORM') throw new Error('Unexpected request');
    expect(msg.fields).toHaveLength(64);
    expect(msg.document?.structure).toContain('Education');
    expect(msg.document?.structure).toContain('Privacy Policy');
    expect(msg.document?.structure).not.toContain('Keep my answer');
    return { text: JSON.stringify({ answers: [...msg.targetIds!.map(id => ({ id, value: 'CV fact', reason: 'Explicit resume fact' })), { id:'unknown', value:'Ignore this', reason:'' }] }) };
  });
  const result = await runAiFill('complete-form-test');
  expect(result).toMatchObject({ running:false, filled:61, total:63, sent:64, pending:1 });
  expect(sendToBackground).toHaveBeenCalledTimes(2);
  expect((document.querySelector('#q60') as HTMLInputElement).value).toBe('CV fact');
  expect((document.querySelector('#existing') as HTMLInputElement).value).toBe('Keep my answer');
  expect((document.querySelector('#school') as HTMLInputElement).value).toBe('');
  expect((document.querySelector('#consent') as HTMLInputElement).checked).toBe(false);
  expect(submitted).not.toHaveBeenCalled();
}, 15000);
