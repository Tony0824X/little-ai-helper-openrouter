import { sendToTab, type PageInfo } from '../lib/messages';

export const PAGE_CONNECTION_MESSAGE = 'The extension has not connected to this page. Reload the job page after installing or updating the extension, then try again.';

/** document_idle and the bundled module import can finish after tabs.onUpdated.
 * Retry only this read-only message, never a fill or an AI request.
 */
export async function readPageInfo(tabId: number): Promise<PageInfo> {
  for (const delay of [0, 200, 600]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const reply = await Promise.race([
        sendToTab<PageInfo>(tabId, { type: 'PAGE_INFO' }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Page timed out')), 2000); }),
      ]);
      if (reply && typeof reply.supported === 'boolean') return reply;
    } catch { /* The content script may still be starting. */ }
    finally { clearTimeout(timer); }
  }
  throw new Error(PAGE_CONNECTION_MESSAGE);
}
