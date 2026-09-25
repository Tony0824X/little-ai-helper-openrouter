import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAGE_CONNECTION_MESSAGE, readPageInfo } from './pageConnection';

const supported = { supported: true, site: 'greenhouse', company: 'Example', role: 'Engineer', jobText: '', hostname: 'job-boards.greenhouse.io' };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('side panel connection recovery', () => {
  it('retries when the bundled content script starts after the tab completes', async () => {
    vi.useFakeTimers();
    const sendMessage = vi.fn().mockRejectedValueOnce(new Error('Receiving end does not exist')).mockResolvedValue(supported);
    vi.stubGlobal('chrome', { tabs: { sendMessage } });
    const result = readPageInfo(23);
    await vi.runAllTimersAsync();
    expect(await result).toEqual(supported);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenLastCalledWith(23, { type: 'PAGE_INFO' });
  });

  it('does not mistake an empty reply for an unsupported site', async () => {
    vi.useFakeTimers();
    const sendMessage = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValue(supported);
    vi.stubGlobal('chrome', { tabs: { sendMessage } });
    const result = readPageInfo(23);
    await vi.runAllTimersAsync();
    expect(await result).toEqual(supported);
  });

  it('accepts an actual unsupported reply without retrying or enabling Fill', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ...supported, supported: false, site: null });
    vi.stubGlobal('chrome', { tabs: { sendMessage } });
    expect((await readPageInfo(23)).supported).toBe(false);
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it('gives reload guidance after an extension update leaves no receiver', async () => {
    vi.useFakeTimers();
    const sendMessage = vi.fn().mockRejectedValue(new Error('Receiving end does not exist'));
    vi.stubGlobal('chrome', { tabs: { sendMessage } });
    const result = expect(readPageInfo(23)).rejects.toThrow(PAGE_CONNECTION_MESSAGE);
    await vi.runAllTimersAsync();
    await result;
    expect(sendMessage).toHaveBeenCalledTimes(3);
  });

  it('does not leave the panel connecting forever when a receiver never replies', async () => {
    vi.useFakeTimers();
    const sendMessage = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('chrome', { tabs: { sendMessage } });
    const result = expect(readPageInfo(23)).rejects.toThrow(PAGE_CONNECTION_MESSAGE);
    await vi.runAllTimersAsync();
    await result;
  });
});
