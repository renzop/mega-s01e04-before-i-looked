import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, ReadNight, ReadNightResult, RunStatus } from './types.js';

// Whole seconds plus a normalized decimal fraction avoid losing sub-millisecond ordering.
type Instant = { second: number; fraction: string };
type RunEvent = {
  at: string;
  instant: Instant;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};
type JobState = {
  row: DigestRow;
  first: Instant;
  last: Instant;
  lastError: Instant | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNight(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseInstant(value: string): Instant | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || match[0] !== value) return null;
  const [, date, hour, minute, second, fraction = '', zone] = match;
  if (!isNight(date) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) {
    return null;
  }
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) {
    return null;
  }
  const epoch = Date.parse(`${date}T${hour}:${minute}:${second}${zone}`);
  return Number.isFinite(epoch)
    ? { second: epoch / 1000, fraction: fraction.replace(/0+$/, '') }
    : null;
}

function compare(a: Instant, b: Instant): number {
  return a.second - b.second || (a.fraction < b.fraction ? -1 : a.fraction > b.fraction ? 1 : 0);
}

function parseEvent(line: string): RunEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(value)
    || typeof value.at !== 'string'
    || typeof value.job !== 'string' || value.job.trim() === ''
    || (value.status !== 'ok' && value.status !== 'retry' && value.status !== 'fail')
    || (typeof value.owner !== 'string' && value.owner !== null)
    || ('error' in value && typeof value.error !== 'string')) {
    return null;
  }
  const instant = parseInstant(value.at);
  if (!instant) return null;
  return {
    at: value.at,
    instant,
    job: value.job,
    status: value.status,
    owner: value.owner,
    error: typeof value.error === 'string' ? value.error : undefined,
  };
}

/** See types.ts for the shared contract, including missing-file and chronological semantics. */
export const readNight: ReadNight = (runsDir, night) => {
  const result: ReadNightResult = {
    night,
    missing: false,
    rows: [],
    badLines: 0,
    counts: { ok: 0, retry: 0, fail: 0 },
  };
  if (!isNight(night)) return { ...result, missing: true };

  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error: unknown) {
    if (isRecord(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      return { ...result, missing: true };
    }
    throw error;
  }

  const jobs = new Map<string, JobState>();
  for (const line of contents.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const event = parseEvent(line);
    if (!event) {
      result.badLines++;
      continue;
    }
    result.counts[event.status]++;
    const state = jobs.get(event.job);
    if (!state) {
      jobs.set(event.job, {
        row: {
          job: event.job,
          owner: event.owner,
          runs: 1,
          retries: event.status === 'retry' ? 1 : 0,
          lastStatus: event.status,
          lastError: event.error ?? null,
          firstAt: event.at,
          lastAt: event.at,
          hasFailure: event.status === 'fail',
        },
        first: event.instant,
        last: event.instant,
        lastError: event.error === undefined ? null : event.instant,
      });
      continue;
    }
    const { row } = state;
    row.runs++;
    if (event.status === 'retry') row.retries++;
    if (event.status === 'fail') row.hasFailure = true;
    if (compare(event.instant, state.first) < 0) {
      state.first = event.instant;
      row.firstAt = event.at;
    }
    if (compare(event.instant, state.last) >= 0) {
      state.last = event.instant;
      row.lastAt = event.at;
      row.lastStatus = event.status;
      row.owner = event.owner;
    }
    if (event.error !== undefined && (state.lastError === null || compare(event.instant, state.lastError) >= 0)) {
      state.lastError = event.instant;
      row.lastError = event.error;
    }
  }
  result.rows = [...jobs.values()].map(({ row }) => row)
    .sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return result;
};
