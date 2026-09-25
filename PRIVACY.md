# Privacy — OpenRouter Free fork

This local fork stores the profile, resume/document text, API key, preferences and saved jobs in Chrome's local extension storage. PDF and DOCX text extraction happens locally.

When you request AI parsing, whole-form filling or an answer, the required profile/document/job context is sent to OpenRouter at `https://openrouter.ai/api/v1/chat/completions`. OpenRouter forwards the request to the selected model's provider. Whole-form filling additionally sends a cleaned HTML representation of the complete loaded form (headings, instructions, tables, labels and local field references), along with field types, options, section/row context, visibility and whether fields already have values. Already-loaded inactive steps are included as context. Scripts, executable attributes, hidden inputs/tokens and existing control values are stripped. Security/identity/consent/file fields remain visible as definitions but are not automatically filled. Large answer sets are split into batches; each batch still receives the complete form context. The API key is never part of the model prompt. This is not offline processing; OpenRouter's and that provider's data policies apply.

The API key is sent only to OpenRouter in the Authorization header, never in the URL. No credentials are included in the distributed extension. The connection-test button sends only a synthetic "Reply with OK" prompt and uses one free-model request.

This fork does not connect to the upstream author's Cloud Run proxy or Google OAuth service, and does not include their OAuth client or extension key. There are no analytics added by this fork. The old proxy/provider code remains in the source for reference but is not connected to this build.

Eligibility scanning, floating badges and document generators have been removed. The content script still runs on websites to detect supported forms and add user-triggered AI-answer controls, including embedded forms. It does not submit job applications.

API errors are reported without copying raw provider error bodies, which could contain personal data. Unfinished/truncated AI responses are discarded. You can remove the extension to delete its locally stored data; this does not delete data already processed by external AI services.

Updated: 2026-09-25.
