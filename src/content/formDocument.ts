import type { FormDocument } from '../lib/formPlan';
import type { FieldBinding } from './formFields';

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const drop = 'script,style,noscript,iframe,svg,canvas,img,video,audio,nav,header,footer,[data-lah-ui],.iti__country-list,.iti__dropdown-content,[role="listbox"]';
const controls = 'input,textarea,select,button,[role="combobox"],[contenteditable="true"]';

/** A semantic copy of the ENTIRE loaded form. No executable attributes, scripts,
 * hidden tokens or existing input values. References are bound to local nodes. */
export function buildFormDocument(bindings: FieldBinding[]): FormDocument {
  const ids = new Map<Element, string>();
  const roots = new Set<Element>();
  for (const binding of bindings) {
    for (const el of binding.elements) ids.set(el, binding.field.id);
    const el = binding.elements[0];
    roots.add(el.closest('form') || el.closest('#application-form, #application_form, [role="form"]') || el.parentElement || el);
  }
  const outerRoots = [...roots].filter(r => ![...roots].some(other => other !== r && other.contains(r)));
  function serialize(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return escape((node.textContent || '').replace(/\s+/g, ' '));
    if (!(node instanceof Element)) return '';
    const id = ids.get(node);
    if (id) return `<field-ref id="${id}"/>`;
    if (node.matches(drop) || node.matches(controls)) return '';
    const body = Array.from(node.childNodes).map(serialize).join('').trim();
    if (!body) return '';
    const tag = node.tagName.toLowerCase();
    if (/^(form|fieldset|legend|table|thead|tbody|tr|th|td|label|h[1-6]|p|ul|ol|li|section|article)$/.test(tag)) {
      const span = /^(td|th)$/.test(tag) && node.hasAttribute('colspan') ? ` colspan="${Number(node.getAttribute('colspan')) || 1}"` : '';
      return `<${tag}${span}>${body}</${tag}>\n`;
    }
    if (tag === 'div') return `<div>${body}</div>\n`;
    return `${body} `;
  }
  const structure = outerRoots.map(serialize).join('\n');
  if (structure.length > 100000) throw new Error('The complete form is too large for one request. No truncated form was sent.');
  const warnings: string[] = [];
  if (bindings.some(b => b.field.visible === false)) warnings.push('Other loaded steps are included as context. Open each step and click Fill to enter its answers.');
  if (document.querySelector('iframe:not([src*="captcha"]):not([src*="youtube"])')) warnings.push('Embedded frames are separate documents; their fields may need to be opened in their own tab.');
  return { title: document.title, structure, warnings };
}
