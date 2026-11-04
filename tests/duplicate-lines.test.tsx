// @vitest-environment happy-dom
// In its own file because preact/debug stays on for everything rendered after it is imported.
import 'preact/debug';
import { render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameFailure } from '../src/ui/GameFailure';
import { Notice } from '../src/ui/Notice';
import { showLastingNotices } from '../src/ui/store';

const LINE = 'The same line.';

describe('two identical lines', () => {
  const host = document.createElement('div');

  afterEach(() => {
    render(null, host);
    vi.restoreAllMocks();
  });

  function expectNoKeyComplaint(): void {
    const complaints = vi.mocked(console.error).mock.calls.filter(([message]) => String(message).includes('same key'));
    expect(complaints).toEqual([]);
  }

  it('both show in the notices, with no duplicate keys', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    showLastingNotices([LINE, LINE]);
    render(<Notice />, host);
    expect(host.querySelectorAll('.ab-notice')).toHaveLength(2);
    expectNoKeyComplaint();
  });

  it('both show on the failure card, with no duplicate keys', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<GameFailure lines={[LINE, LINE]} />, host);
    expect(host.querySelectorAll('.app__text')).toHaveLength(2);
    expectNoKeyComplaint();
  });
});
