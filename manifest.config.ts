import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json' with { type: 'json' };

// Hosts where the full autofill adapters run (standard HTML application forms).
// Kept for host_permissions; adapters self-detect via their own matches().
const GREENHOUSE_MATCHES = [
  'https://boards.greenhouse.io/*',
  'https://job-boards.greenhouse.io/*',
  'https://*.greenhouse.io/*',
];
const LEVER_MATCHES = ['https://jobs.lever.co/*'];
const WORKDAY_MATCHES = [
  'https://*.myworkdayjobs.com/*',
  'https://*.myworkday.com/*',
  'https://*.myworkdaysite.com/*',
];
// Only the candidate-facing job board. app.ashbyhq.com is Ashby's
// recruiter-facing product and must never trigger autofill.
const ASHBY_MATCHES = ['https://jobs.ashbyhq.com/*'];

// Detect supported forms, capture saved-job context, and show on-demand AI
// answers. No eligibility scanner or floating badge runs in this build.
const CONTENT_MATCHES = ['<all_urls>'];

export default defineManifest({
  manifest_version: 3,
  name: 'Little AI Helper — OpenRouter Free',
  version: pkg.version,
  description: pkg.description,
  icons: {
    '16': 'icons/icon16.png',
    '48': 'icons/icon48.png',
    '128': 'icons/icon128.png',
  },
  // No default_popup: clicking the action opens the side panel (set up in the
  // service worker via setPanelBehavior) so the UI stays open until closed.
  action: {
    default_title: 'Little AI Helper — OpenRouter Free',
  },
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  options_page: 'src/options/index.html',
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  // Independent unpacked extension: no upstream OAuth client, identity permission,
  // publisher key, Gemini endpoint, or managed Cloud Run backend.
  permissions: ['storage', 'activeTab', 'sidePanel'],
  host_permissions: [
    ...GREENHOUSE_MATCHES, ...LEVER_MATCHES, ...WORKDAY_MATCHES, ...ASHBY_MATCHES,
    'https://openrouter.ai/*',
  ],
  content_scripts: [
    {
      matches: CONTENT_MATCHES,
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
      // Run in sub-frames too: company career sites (e.g. Suvoda) embed the ATS
      // application form in an iframe, so the AI-answer buttons must reach it. The
      // popup-messaging handlers and the eligibility badge stay top-frame-only.
      all_frames: true,
    },
  ],
});
