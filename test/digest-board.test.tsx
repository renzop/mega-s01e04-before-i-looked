import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { readStatus } from '../src/status.js';

describe('digest links on the status board', () => {
  let runsDir: string;
  const config = () => ({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  });

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-board-'));
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  it('links every night newest first with raw event counts, including recovered failures', async () => {
    const events = ['fail', 'retry', 'retry', 'ok', 'ok'].map((status, index) =>
      JSON.stringify({
        at: `2026-10-28T01:00:0${index}+01:00`,
        job: 'same-job',
        owner: null,
        status,
      }),
    );
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), [...events, '{broken', ''].join('\n'));
    writeFileSync(join(runsDir, '2026-10-29.jsonl'), '');
    writeFileSync(join(runsDir, 'notes.txt'), 'not a night');

    const status = readStatus(config());
    expect(status.nights).toEqual(['2026-10-29', '2026-10-28']);
    expect(status.nightCounts).toEqual({
      '2026-10-29': { ok: 0, retry: 0, fail: 0 },
      '2026-10-28': { ok: 2, retry: 2, fail: 1 },
    });

    const response = await createApp(config()).request('/');
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('<a href="/digest/2026-10-29">2026-10-29</a> · 0 ok / 0 retry / 0 fail');
    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a> · 2 ok / 2 retry / 1 fail');
    expect(html.indexOf('/digest/2026-10-29')).toBeLessThan(html.indexOf('/digest/2026-10-28'));
    expect(html).toContain('shim');
    expect(html).toContain('2026-10-29T14:06:00+01:00');
    expect(html).toContain('last beat');
    expect(html).not.toContain('notes.txt');
    expect(html).not.toContain('<script');
  });

  it('preserves the empty board message', async () => {
    const response = await createApp(config()).request('/');
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('nothing in runs/');
    expect(html).not.toContain('/digest/');
  });

  it('preserves the empty board for an absent runs directory', () => {
    rmSync(runsDir, { recursive: true });
    expect(readStatus(config()).nights).toEqual([]);
    expect(readStatus(config()).nightCounts).toEqual({});
  });
});
