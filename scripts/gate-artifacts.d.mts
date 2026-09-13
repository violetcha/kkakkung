import type { GateInput, EvidenceReader } from './verify-mvp-evidence.mjs';
export const GATE_TEST_FILES: Readonly<Record<string, readonly string[]>>;
export function createEvidenceReader(root: string, input: string): EvidenceReader;
export function readBoundArtifact(
  ref: string,
  hashes: Record<string, string>,
  read: EvidenceReader,
): Record<string, unknown>;
export function validateGateArtifact(
  doc: Record<string, unknown>,
  gate: GateInput,
  build: { sourceCommit: string | null; lockfileHash?: string },
  now: number,
): Record<string, number>;
