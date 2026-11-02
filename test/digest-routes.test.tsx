import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { ReadNightResult } from '../src/digest/types.js';

const night = '2026-10-28';

// Inspect table rows, not the surrounding layout or an exact serialization of JSX.
function tableRows(html: string): string[] {
  return (html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? [])
    .filter((row) => /<td\b/i.test(row));
}

function cells(row: string): string[] {
  return [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
    .map((match) => match[1].replace(/<[^>]*>/g, '').trim());
}

function isMarked(row: string): boolean {
  return /class=["'][^"']*\bwarn\b[^"']*["']|<mark\b/i.test(row);
}

describe('digest routes', () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  function app() {
    return createApp({
      adapter: 'shim',
      installed: '2026-10-29T14:06:00+01:00',
      beatEverySeconds: 60,
      runsDir,
    });
  }

  function log(lines: unknown[]) {
    writeFileSync(join(runsDir, `${night}.jsonl`), lines.map((line) => JSON.stringify(line)).join('\n'));
  }

  async function responses() {
    const server = app();
    const html = await server.request(`/digest/${night}`);
    const json = await server.request(`/api/digest/${night}`);
    return { html, json };
  }

  it('serves HTML and the full JSON result in the same job order, retaining null owners and offsets', async () => {
    // Lexical timestamp order is deliberately the opposite of chronological order.
    const firstAt = '2026-10-28T01:30:00+02:00';
    const lastAt = '2026-10-28T00:45:00+00:00';
    log([
      { at: lastAt, job: 'zebra-job', status: 'ok', owner: null },
      { at: firstAt, job: 'zebra-job', status: 'fail', owner: 'earlier-owner', error: 'connection lost' },
      { at: firstAt, job: 'alpha-job', status: 'ok', owner: 'alpha-owner' },
    ]);

    const { html, json } = await responses();
    expect(html.status).toBe(200);
    expect(html.headers.get('content-type')).toContain('text/html');
    expect(json.status).toBe(200);
    expect(json.headers.get('content-type')).toContain('application/json');
    const result: ReadNightResult = await json.json();
    expect(result).toEqual({
      night, missing: false, badLines: 0, counts: { ok: 2, retry: 0, fail: 1 },
      rows: [
        { job: 'alpha-job', owner: 'alpha-owner', runs: 1, retries: 0, lastStatus: 'ok', lastError: null, firstAt, lastAt: firstAt, hasFailure: false },
        { job: 'zebra-job', owner: null, runs: 2, retries: 0, lastStatus: 'ok', lastError: 'connection lost', firstAt, lastAt, hasFailure: true },
      ],
    });
    const body = await html.text();
    const rows = tableRows(body);
    expect(rows).toHaveLength(result.rows.length);
    rows.forEach((row, index) => {
      const expected = result.rows[index];
      const values = cells(row);
      expect(values).toContain(expected.job);
      expect(values).toContain(expected.owner ?? '—');
      expect(row).toContain(expected.firstAt);
      expect(row).toContain(expected.lastAt);
    });
    expect(rows[1]).toContain('connection lost');
    expect(isMarked(rows[0])).toBe(false);
    expect(isMarked(rows[1])).toBe(true); // A recovered failure must still be marked.
    expect(body).not.toMatch(/<script\b/i);
  });

  it('returns 404 for a night with no file on both routes', async () => {
    const { html, json } = await responses();
    expect(html.status).toBe(404);
    expect(json.status).toBe(404);
    expect(await json.json()).toEqual({
      night, missing: true, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('distinguishes an existing empty file from a missing night', async () => {
    log([]);
    const { html, json } = await responses();
    expect(html.status).toBe(200);
    expect(await html.text()).toMatch(/nothing ran/i);
    expect(json.status).toBe(200);
    expect(await json.json()).toEqual({
      night, missing: false, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('counts malformed JSON and invalid shapes without losing valid rows or throwing', async () => {
    const path = join(runsDir, `${night}.jsonl`);
    // Blank lines are not bad lines; a parseable but invalid event is.
    writeFileSync(path, `${JSON.stringify({ at: '2026-10-28T09:00:00+01:00', job: 'surviving-job', status: 'ok', owner: null })}\n\nnot-json\n{}\n`);
    const { html, json } = await responses();
    expect(html.status).toBe(200);
    const body = await html.text();
    expect(body).toContain('surviving-job');
    expect(body).toMatch(/(?:2\s+(?:bad|malformed|invalid)|(?:bad|malformed|invalid)[^<\n]*\s2)/i);
    expect(json.status).toBe(200);
    const result: ReadNightResult = await json.json();
    expect(result.badLines).toBe(2);
    expect(result.missing).toBe(false);
    expect(result.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
    expect(result.rows.map((row) => row.job)).toEqual(['surviving-job']);
  });

  it('marks retries at three, not two, and reports raw retry counts', async () => {
    log(['three-retries', 'two-retries'].flatMap((job, index) =>
      Array.from({ length: 3 - index }, (_, minute) => ({
        at: `2026-10-28T09:0${minute}:00+01:00`, job, status: 'retry', owner: 'operator',
      })),
    ));
    const { html, json } = await responses();
    expect(html.status).toBe(200);
    expect(json.status).toBe(200);
    const result: ReadNightResult = await json.json();
    expect(result.counts).toEqual({ ok: 0, retry: 5, fail: 0 });
    expect(result.rows.map(({ job, runs, retries, hasFailure }) => ({ job, runs, retries, hasFailure }))).toEqual([
      { job: 'three-retries', runs: 3, retries: 3, hasFailure: false },
      { job: 'two-retries', runs: 2, retries: 2, hasFailure: false },
    ]);
    const rows = tableRows(await html.text());
    expect(rows).toHaveLength(2);
    expect(cells(rows[0])).toContain('three-retries');
    expect(cells(rows[1])).toContain('two-retries');
    expect(isMarked(rows[0])).toBe(true);
    expect(isMarked(rows[1])).toBe(false);
  });
});
