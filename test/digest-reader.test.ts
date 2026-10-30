import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const night = '2026-10-28';
const event = {
  at: '2026-10-28T23:00:00+01:00',
  job: 'job/a',
  status: 'ok',
  owner: 'rook',
};

let runsDir: string;
beforeEach(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-reader-'));
});
afterEach(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

function writeLines(lines: unknown[]) {
  writeFileSync(join(runsDir, `${night}.jsonl`), lines.map((line) => JSON.stringify(line)).join('\n'));
}

const zeroCounts = { ok: 0, retry: 0, fail: 0 };

describe('readNight', () => {
  it('reads the supplied night: five sorted jobs, one bad line, and raw event counts', () => {
    const fixtureDir = dirname(fileURLToPath(new URL('../runs/2026-10-28.jsonl', import.meta.url)));
    const result = readNight(fixtureDir, night);
    expect(result.night).toBe(night);
    expect(result.missing).toBe(false);
    expect(result.badLines).toBe(1);
    expect(result.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(result.rows).toEqual([
      {
        job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok',
        lastError: null, firstAt: '2026-10-29T05:41:09+01:00',
        lastAt: '2026-10-29T05:41:09+01:00', hasFailure: false,
      },
      {
        job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok',
        lastError: 'upstream 503', firstAt: '2026-10-29T01:30:00+01:00',
        lastAt: '2026-10-29T01:37:00+01:00', hasFailure: false,
      },
      {
        job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, lastStatus: 'ok',
        lastError: 'lock held', firstAt: '2026-10-28T23:00:06+01:00',
        lastAt: '2026-10-29T05:00:04+01:00', hasFailure: false,
      },
      {
        job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'fail',
        lastError: 'quota exceeded', firstAt: '2026-10-29T04:00:01+01:00',
        lastAt: '2026-10-29T04:00:01+01:00', hasFailure: true,
      },
      {
        job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'ok',
        lastError: null, firstAt: '2026-10-28T23:00:02+01:00',
        lastAt: '2026-10-28T23:00:02+01:00', hasFailure: false,
      },
    ]);
  });

  it('distinguishes missing, empty, and all-bad nights', () => {
    expect(readNight(runsDir, night)).toEqual({
      night, missing: true, rows: [], badLines: 0, counts: zeroCounts,
    });
    writeFileSync(join(runsDir, `${night}.jsonl`), '');
    expect(readNight(runsDir, night)).toEqual({
      night, missing: false, rows: [], badLines: 0, counts: zeroCounts,
    });
    writeFileSync(join(runsDir, `${night}.jsonl`), '{broken\nnull\n');
    expect(readNight(runsDir, night)).toEqual({
      night, missing: false, rows: [], badLines: 2, counts: zeroCounts,
    });
  });

  it('counts malformed lines, ignores blanks, and continues through CRLF and a final unterminated line', () => {
    writeFileSync(join(runsDir, `${night}.jsonl`), [
      '', '  ', JSON.stringify(event), '{broken', '\t', JSON.stringify(event),
    ].join('\r\n'));
    const result = readNight(runsDir, night);
    expect(result.badLines).toBe(1);
    expect(result.counts).toEqual({ ok: 2, retry: 0, fail: 0 });
    expect(result.rows[0].runs).toBe(2);
  });

  it.each([
    null, [], 42, 'text', {},
    { ...event, at: null }, { ...event, at: 'not a date' },
    { ...event, at: '2026-10-28T12:00:00' },
    { ...event, at: '2026-10-28T12:00:00Z\n' },
    { ...event, at: '2026-02-30T12:00:00Z' },
    { ...event, at: '2026-10-28T24:00:00Z' },
    { ...event, at: '2026-10-28T12:60:00Z' },
    { ...event, at: '2026-10-28T12:00:60Z' },
    { ...event, at: '2026-10-28T12:00:00+24:00' },
    { ...event, at: '2026-10-28T12:00:00+01:60' },
    { ...event, job: null }, { ...event, job: '' }, { ...event, job: '  ' },
    { ...event, status: 'unknown' }, { ...event, status: null },
    { at: event.at, job: event.job, status: event.status },
    { ...event, owner: 42 }, { ...event, error: null }, { ...event, error: {} },
  ])('counts invalid event shape %# without throwing', (invalid) => {
    writeLines([invalid, event]);
    const result = readNight(runsDir, night);
    expect(result.badLines).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].runs).toBe(1);
    expect(result.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
  });

  it('accepts extra fields, a null owner, and an empty string error', () => {
    writeLines([{ ...event, owner: null, error: '', extra: { ignored: true } }]);
    const result = readNight(runsDir, night);
    expect(result.badLines).toBe(0);
    expect(result.rows[0]).toMatchObject({ owner: null, lastError: '' });
  });

  it('uses actual instants rather than text or line order, preserving offsets and recovered failures', () => {
    writeLines([
      { ...event, at: '2026-10-29T00:30:00+02:00', status: 'fail', error: 'latest error' },
      { ...event, at: '2026-10-28T23:00:00Z', owner: null },
      { ...event, at: '2026-10-28T22:00:00+01:00', status: 'retry', error: 'older error' },
    ]);
    expect(readNight(runsDir, night)).toMatchObject({
      counts: { ok: 1, retry: 1, fail: 1 },
      rows: [{
        job: event.job, owner: null, runs: 3, retries: 1, lastStatus: 'ok',
        lastError: 'latest error', firstAt: '2026-10-28T22:00:00+01:00',
        lastAt: '2026-10-28T23:00:00Z', hasFailure: true,
      }],
    });
  });

  it('breaks equal-instant ties by later line for latest fields and errors', () => {
    writeLines([
      { ...event, at: '2026-10-28T23:00:00+01:00', status: 'fail', error: 'first error' },
      { ...event, at: '2026-10-28T22:00:00Z', status: 'retry', owner: null, error: 'second error' },
      { ...event, at: '2026-10-28T22:00:00.000Z', owner: 'last owner' },
    ]);
    expect(readNight(runsDir, night).rows[0]).toMatchObject({
      owner: 'last owner', lastStatus: 'ok', lastError: 'second error',
      firstAt: '2026-10-28T23:00:00+01:00', lastAt: '2026-10-28T22:00:00.000Z',
      hasFailure: true,
    });
  });

  it('orders fractional seconds without losing sub-millisecond precision', () => {
    writeLines([
      { ...event, at: '2026-10-28T22:00:00.1009Z', owner: 'latest' },
      { ...event, at: '2026-10-28T22:00:00.10010Z', owner: 'earliest' },
      { ...event, at: '2026-10-28T22:00:00.100100Z', owner: 'same instant' },
    ]);
    expect(readNight(runsDir, night).rows[0]).toMatchObject({
      owner: 'latest', firstAt: '2026-10-28T22:00:00.10010Z', lastAt: '2026-10-28T22:00:00.1009Z',
    });
  });

  it('sorts jobs deterministically and safely handles prototype-like job names', () => {
    writeLines(['z', '__proto__', 'A', 'a', 'constructor'].map((job) => ({ ...event, job })));
    expect(readNight(runsDir, night).rows.map(({ job }) => job))
      .toEqual(['A', '__proto__', 'a', 'constructor', 'z']);
  });

  it.each([
    '', '../2026-10-28', '../../2026-10-28', '/2026-10-28', '..\\2026-10-28',
    '%2e%2e%2f2026-10-28', '2026-10-28/..', '2026-10-28\0',
    '2026-10-28.jsonl', '2026-1-01', '2026-02-29', '2026-04-31', '2026-13-01',
    '2026-10-28\n',
  ])('treats unsafe or invalid night %j as missing', (invalidNight) => {
    writeLines([event]);
    expect(readNight(runsDir, invalidNight)).toEqual({
      night: invalidNight, missing: true, rows: [], badLines: 0, counts: zeroCounts,
    });
  });

  it('does not read an existing file outside runsDir through traversal', () => {
    writeLines([event]);
    const nested = join(runsDir, 'nested');
    mkdirSync(nested);
    expect(readNight(nested, `../${night}`)).toEqual({
      night: `../${night}`, missing: true, rows: [], badLines: 0, counts: zeroCounts,
    });
  });

  it('accepts a real leap day', () => {
    writeFileSync(join(runsDir, '2028-02-29.jsonl'), JSON.stringify(event));
    expect(readNight(runsDir, '2028-02-29').missing).toBe(false);
  });

  it('handles missing runs directories and non-directory parents as missing', () => {
    expect(readNight(join(runsDir, 'absent'), night).missing).toBe(true);
    writeFileSync(join(runsDir, 'file'), '');
    expect(readNight(join(runsDir, 'file'), night).missing).toBe(true);
  });

  it('propagates other filesystem errors instead of silently reporting missing', () => {
    mkdirSync(join(runsDir, `${night}.jsonl`));
    expect(() => readNight(runsDir, night)).toThrow();
  });
});
