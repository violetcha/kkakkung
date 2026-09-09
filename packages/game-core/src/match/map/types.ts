import type { MapPreparationFailure } from '../types.js';

export type TemplateIssueCode =
  | 'INVALID_TYPE'
  | 'MISSING_FIELD'
  | 'SOURCE_MISMATCH'
  | 'INVALID_SIZE'
  | 'ROW_LENGTH'
  | 'INVALID_CELL'
  | 'OUTER_WALL'
  | 'OUT_OF_RANGE'
  | 'DUPLICATE_ID'
  | 'REGION_COUNT'
  | 'REGION_EMPTY'
  | 'REGION_NOT_PASSAGE'
  | 'REGION_OVERLAP'
  | 'SPAWN_OUTSIDE_REGION'
  | 'SPAWN_NOT_PASSAGE'
  | 'SPAWN_NEIGHBORS'
  | 'DUPLICATE_CANDIDATE'
  | 'EXIT_NOT_WALL'
  | 'EXIT_OUTER'
  | 'EXIT_APPROACH_BLOCKED';

/** Server-internal detailed issue. `path` is a JSON path; nothing is auto-corrected. */
export type TemplateIssue = Readonly<{
  code: TemplateIssueCode;
  path: readonly (string | number)[];
  message: string;
}>;

/**
 * Contract failure (`status/code/path`) extended with the full internal issue
 * list. Consumers may rely on the contract fields only; `issues` is diagnostics.
 */
export type TemplateFailure = MapPreparationFailure &
  Readonly<{ issues: readonly TemplateIssue[] }>;

/** Generic ok/issues result used by non-contract validators such as tuning. */
export type TemplateValidation<T> =
  Readonly<{ ok: true; template: T }> | Readonly<{ ok: false; issues: readonly TemplateIssue[] }>;
