export function productCapacityOverlay(operatingMode: string): string;
export function readProductCapacity(
  root: string,
  operatingMode: string,
): Readonly<{ MAX_ROOMS: string; MAX_SLOTS: string }>;
