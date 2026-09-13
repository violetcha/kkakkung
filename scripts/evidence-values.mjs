/** Evidence timestamps need an explicit timezone and a real calendar date. */
export function evidenceTime(value) {
  if (typeof value !== 'string') return null;
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!parts) return null;
  const [, year, month, day, hour, minute, second, zone] = parts;
  if (
    +year < 2000 ||
    +month < 1 ||
    +month > 12 ||
    +day < 1 ||
    +day > new Date(Date.UTC(+year, +month, 0)).getUTCDate() ||
    +hour > 23 ||
    +minute > 59 ||
    +second > 59 ||
    (zone !== 'Z' &&
      (+zone.slice(1, 3) > 14 ||
        +zone.slice(4) > 59 ||
        (+zone.slice(1, 3) === 14 && +zone.slice(4) !== 0)))
  )
    return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export const isCommit = (value) => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
export const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
