import type { EducationEntry, PersonalInfo, Preferences, Profile, WorkEntry } from './profile';

type ResumePreferences = Pick<Preferences, 'workAuthorization' | 'requiresSponsorship' | 'salaryExpectation'>;
const preferenceKeys: (keyof ResumePreferences)[] = ['workAuthorization', 'requiresSponsorship', 'salaryExpectation'];

export interface ParsedResume {
  /** Only fields the AI actually found; merge over existing values. */
  personal: Partial<PersonalInfo>;
  work: WorkEntry[];
  education: EducationEntry[];
  skills: string[];
  preferences: Partial<ResumePreferences>;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Parses the model's JSON response into typed profile sections. Tolerates code
 * fences and stray prose around the JSON object.
 */
export function parseResumeJson(raw: string): ParsedResume {
  const data = parseLooseJson(raw);
  if (data === null) {
    throw new Error('Could not parse the AI response as JSON. Try again.');
  }

  const obj = (data ?? {}) as Record<string, unknown>;
  const personalIn = (obj.personal ?? {}) as Record<string, unknown>;
  const workIn = Array.isArray(obj.work) ? obj.work : [];
  const eduIn = Array.isArray(obj.education) ? obj.education : [];
  const skillsIn = Array.isArray(obj.skills) ? obj.skills : [];
  const preferencesIn = (obj.preferences ?? {}) as Record<string, unknown>;

  // Keep only non-empty personal fields so we never clobber existing data.
  const personalKeys: (keyof PersonalInfo)[] = [
    'firstName', 'lastName', 'email', 'phone', 'city', 'state', 'country',
    'linkedin', 'github', 'portfolio',
  ];
  const personal: Partial<PersonalInfo> = {};
  for (const key of personalKeys) {
    const v = str(personalIn[key]);
    if (v) personal[key] = v;
  }

  const work: WorkEntry[] = workIn
    .map((w) => {
      const e = (w ?? {}) as Record<string, unknown>;
      return {
        title: str(e.title),
        company: str(e.company),
        startDate: str(e.startDate),
        endDate: str(e.endDate),
        description: str(e.description),
      };
    })
    .filter((w) => w.title || w.company);

  const education: EducationEntry[] = eduIn
    .map((ed) => {
      const e = (ed ?? {}) as Record<string, unknown>;
      return {
        school: str(e.school),
        degree: str(e.degree),
        field: str(e.field),
        graduationYear: str(e.graduationYear),
      };
    })
    .filter((e) => e.school || e.degree);

  const skills = skillsIn.map(str).filter(Boolean);

  const preferences: Partial<ResumePreferences> = {};
  for (const key of preferenceKeys) {
    const rawValue = preferencesIn[key];
    let value = str(rawValue);
    if (key === 'requiresSponsorship') {
      // A stated false is No, while missing/unknown must remain absent.
      if (rawValue === true || /^yes$/i.test(value)) value = 'Yes';
      else if (rawValue === false || /^no$/i.test(value)) value = 'No';
      else value = '';
    }
    if (value) preferences[key] = value;
  }

  return { personal, work, education, skills, preferences };
}

/** Missing facts never clear preferences; edits made during the AI request win. */
export function mergeResumeProfile(current: Profile, parsed: ParsedResume, startedFrom: Profile = current): Profile {
  const preferences = { ...current.preferences };
  for (const key of preferenceKeys) {
    if (parsed.preferences[key] && current.preferences[key] === startedFrom.preferences[key]) {
      preferences[key] = parsed.preferences[key];
    }
  }
  return {
    ...current,
    personal: { ...current.personal, ...parsed.personal },
    workHistory: parsed.work.length ? parsed.work : current.workHistory,
    education: parsed.education.length ? parsed.education : current.education,
    skills: parsed.skills.length ? parsed.skills : current.skills,
    preferences,
  };
}

/**
 * Extracts the JSON object from a model response that may be wrapped in code
 * fences or surrounded by prose. Scans from the first `{` tracking string/escape
 * state to find the matching close brace, so an opening fence (before the first
 * `{`) and trailing commentary or closing fence are both dropped without editing
 * the object itself — a literal ``` inside a string value survives. If the
 * response was truncated (never balances), returns everything from the first `{`
 * onward, minus a dangling fence, and lets {@link parseLooseJson} repair it.
 */
export function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;

  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') {
      stack.pop();
      if (stack.length === 0) return raw.slice(start, i + 1);
    }
  }
  // Unbalanced → truncated response; hand the tail to the repair step. Only a
  // trailing fence is structural noise here: inside the object it would have to
  // sit in a string value, which the scan above never left.
  return raw.slice(start).replace(/\s*```\s*$/, '');
}

/** Replaces raw control characters with spaces — models sometimes emit an
 * unescaped newline/tab inside a string value, which is invalid JSON. Structural
 * whitespace is unaffected (it's already insignificant between tokens). */
function stripControlChars(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001F]/g, ' ');
}

/** Balances an unterminated JSON fragment: closes a dangling string, drops a
 * trailing comma/whitespace, then appends the missing `}`/`]` in the right order. */
function closeOpen(s: string): string {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') stack.pop();
  }
  let out = inStr ? `${s}"` : s;
  out = out.replace(/[,\s]+$/, ''); // trailing comma / whitespace (keeps a closing quote)
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i];
  return out;
}

/**
 * Parses a JSON object out of a raw model response, tolerating the ways models
 * break strict JSON: code fences, surrounding prose, unescaped control chars in
 * string values, and truncation. For a truncated response it recovers as much as
 * parses by closing the fragment and, if that still fails, trimming back to the
 * last structural boundary and retrying. Returns null only when nothing is
 * recoverable.
 */
export function parseLooseJson(raw: string): unknown | null {
  const extracted = extractJsonObject(raw);
  if (!extracted) return null;
  const sanitized = stripControlChars(extracted);

  try {
    return JSON.parse(sanitized);
  } catch {
    // Fall through to truncation recovery.
  }

  let candidate = sanitized;
  for (let attempt = 0; attempt < 60 && candidate.length; attempt++) {
    try {
      return JSON.parse(closeOpen(candidate));
    } catch {
      // Trim back to the last comma / closing bracket and try a shorter prefix.
      const cut = Math.max(
        candidate.lastIndexOf(','),
        candidate.lastIndexOf('}'),
        candidate.lastIndexOf(']'),
      );
      if (cut <= 0) break;
      candidate = candidate.slice(0, cut);
    }
  }
  return null;
}
