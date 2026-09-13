const uuid = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';

export const validMediaEpoch = (value: string): boolean => new RegExp(`^${uuid}$`).test(value);
export const validMediaNamespace = (value: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value) && !value.includes('--');

export function ownsMediaRoom(namespace: string, roomName: string): boolean {
  return (
    validMediaNamespace(namespace) &&
    typeof roomName === 'string' &&
    new RegExp(`^${namespace}--${uuid}--${uuid}$`).test(roomName)
  );
}
