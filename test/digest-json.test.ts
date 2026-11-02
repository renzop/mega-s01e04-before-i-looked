import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('digest JSON', () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-json-'));
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  function request(night: string) {
    return createApp({
      adapter: 'shim',
      installed: '2026-10-29T14:06:00+01:00',
      beatEverySeconds: 60,
      runsDir,
    }).request(`/api/digest/${night}`);
  }

  it('returns the full reader result with sorted jobs, raw counts, and bad lines', async () => {
    const at = '2026-10-28T01:00:00+01:00';
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), [
      JSON.stringify({ at, job: 'zeta', owner: null, status: 'fail', error: 'broken' }),
      'not JSON',
      JSON.stringify({ at, job: 'alpha', owner: 'Ada', status: 'retry' }),
      JSON.stringify({ at, job: 'zeta', owner: 'Zoe', status: 'ok' }),
      '',
    ].join('\n'));

    const response = await request('2026-10-28');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({
      night: '2026-10-28',
      missing: false,
      rows: [
        {
          job: 'alpha', owner: 'Ada', runs: 1, retries: 1, lastStatus: 'retry',
          lastError: null, firstAt: at, lastAt: at, hasFailure: false,
        },
        {
          job: 'zeta', owner: 'Zoe', runs: 2, retries: 0, lastStatus: 'ok',
          lastError: 'broken', firstAt: at, lastAt: at, hasFailure: true,
        },
      ],
      badLines: 1,
      counts: { ok: 1, retry: 1, fail: 1 },
    });
  });

  it('returns 200 and empty rows for an existing empty night', async () => {
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), '');

    const response = await request('2026-10-28');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      night: '2026-10-28', missing: false, rows: [], badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it.each(['2026-10-28', '2026-02-30', 'not-a-night'])(
    'returns the full missing result with 404 for %s',
    async (night) => {
      const response = await request(night);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        night, missing: true, rows: [], badLines: 0,
        counts: { ok: 0, retry: 0, fail: 0 },
      });
    },
  );
});
