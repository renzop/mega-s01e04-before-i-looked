import { describe, expect, it } from 'vitest';
import type { DigestRow, ReadNightResult } from '../src/digest/types.js';
import { DigestPage } from '../src/views/digest.js';
import { Layout } from '../src/views/layout.js';

const row: DigestRow = {
  job: 'alpha',
  owner: null,
  runs: 5,
  retries: 3,
  lastStatus: 'ok',
  lastError: 'previous <failure>',
  firstAt: '2026-10-28T01:00:00+05:30',
  lastAt: '2026-10-28T02:00:00+05:30',
  hasFailure: true,
};

function render(overrides: Partial<ReadNightResult> = {}) {
  const digest: ReadNightResult = {
    night: '2026-10-28', missing: false, rows: [row], badLines: 1,
    counts: { ok: 1, retry: 3, fail: 1 }, ...overrides,
  };
  return (
    <Layout title="digest" lane={{ id: 'test-lane', marker: null }}>
      <DigestPage digest={digest} />
    </Layout>
  ).toString();
}

describe('digest page HTML', () => {
  it('renders every field, original offsets, and recovered failure warnings', () => {
    const html = render();
    expect(html).toContain('test-lane');
    expect(html).toContain('no marker set');
    expect(html).toContain('digest · 2026-10-28');
    expect(html).toContain('bad lines: 1');
    expect(html).toContain('alpha');
    expect(html).toContain('<td>—</td>');
    expect(html).toContain('<td>5</td>');
    expect(html).toContain('<strong>3 (high)</strong>');
    expect(html).toContain('<td>ok</td>');
    expect(html).toContain('previous &lt;failure&gt;');
    expect(html).toContain(row.firstAt);
    expect(html).toContain(row.lastAt);
    expect(html).toContain('<td class="warn"><strong>yes</strong></td>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<link');
  });

  it('preserves reader order and does not warn below the retry threshold', () => {
    const html = render({ rows: [
      { ...row, job: 'z-first', retries: 2, hasFailure: false, lastError: null },
      { ...row, job: 'a-second' },
    ] });
    expect(html.indexOf('z-first')).toBeLessThan(html.indexOf('a-second'));
    expect(html).toContain('<td>2</td>');
    expect(html).toContain('<td>no</td>');
    expect(html.match(/<td>—<\/td>/g)).toHaveLength(3);
  });

  it('shows an existing empty night and its malformed-line count', () => {
    const html = render({ rows: [], badLines: 2 });
    expect(html).toContain('nothing ran');
    expect(html).toContain('bad lines: 2');
    expect(html).not.toContain('<table');
  });

  it('distinguishes a missing night from an empty night', () => {
    const html = render({ missing: true, rows: [], badLines: 0 });
    expect(html).toContain('night not found');
    expect(html).not.toContain('nothing ran');
  });
});
