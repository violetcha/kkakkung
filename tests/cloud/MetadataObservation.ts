/** QA-08 observation gate only. Existing preflight limits remain unchanged. */
export type MetadataObservation = Readonly<{
  status: 'PASS' | 'FAIL';
  code:
    | 'QA08_OBSERVED'
    | 'QA08_NOT_COMPLETED'
    | 'QA08_NO_NAMESPACE_ROOMS'
    | 'QA08_NO_PARTICIPANTS'
    | 'QA08_INVALID_COUNTS';
  rooms: number;
  participants: number;
}>;

/** Only counts and fixed codes are returned; no room, identity or metadata values. */
export function evaluateMetadataObservation(
  rooms: number,
  participants: number,
  completed: boolean,
): MetadataObservation {
  const code =
    !Number.isSafeInteger(rooms) ||
    rooms < 0 ||
    !Number.isSafeInteger(participants) ||
    participants < 0
      ? 'QA08_INVALID_COUNTS'
      : !completed
        ? 'QA08_NOT_COMPLETED'
        : rooms === 0
          ? 'QA08_NO_NAMESPACE_ROOMS'
          : participants === 0
            ? 'QA08_NO_PARTICIPANTS'
            : 'QA08_OBSERVED';
  return { status: code === 'QA08_OBSERVED' ? 'PASS' : 'FAIL', code, rooms, participants };
}
