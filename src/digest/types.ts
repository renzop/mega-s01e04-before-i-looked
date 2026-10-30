/** The status of one valid JSONL event, not a job's eventual outcome. */
export type RunStatus = 'ok' | 'retry' | 'fail'

/** Counts of all valid events in the night, including retries and recovered failures. */
export type StatusCounts = Record<RunStatus, number>

/** One job, aggregated from valid events and returned in ascending job-name order. */
export type DigestRow = {
  job: string
  /** Owner of the chronologically latest event; null is preserved, not filled in. */
  owner: string | null
  /** Number of valid events for this job, including retry and fail events. */
  runs: number
  /** Number of this job's events whose status is retry. */
  retries: number
  lastStatus: RunStatus
  /** Most recent supplied error, or null; a later event without error does not erase it. */
  lastError: string | null
  /** Original timestamps (including offsets), selected by actual instant, not text order. */
  firstAt: string
  lastAt: string
  /** True if any event failed, even when lastStatus is now ok. */
  hasFailure: boolean
}

/** Same shape for present, empty, missing, and invalid-night requests. */
export type ReadNightResult = {
  /** The requested night, unchanged. */
  night: string
  /** True for an absent file or an invalid night; false for an existing empty file. */
  missing: boolean
  rows: DigestRow[]
  /** Nonblank lines with invalid JSON or invalid event shape; blank lines are ignored. */
  badLines: number
  counts: StatusCounts
}

/**
 * Synchronous named export readNight from src/digest/reader.ts (import './digest/reader.js').
 * Reads runsDir/<night>.jsonl. Only real calendar dates in YYYY-MM-DD form are accepted;
 * unsafe/invalid nights are treated as missing without accessing the filesystem.
 * Missing results have empty rows, zero badLines, and zero counts; empty existing files
 * have those same values but missing=false. Other filesystem errors propagate.
 * Events require at (an ISO timestamp with explicit Z/offset), nonempty job, status,
 * owner (string or null), and optional string error. Extra fields are ignored.
 * Chronological ties use file order: the later line supplies latest fields/error.
 * Malformed events are counted and skipped. Original timestamp strings are preserved.
 */
export type ReadNight = (runsDir: string, night: string) => ReadNightResult
