import { randomUUID } from 'node:crypto';

// A durable time boundary can reject a retired request without retaining every old UUID.
// Legacy IDs remain readable and existing live reservations keep their exact identity.
export function createUsageReservationId(nowEpochMs: number): string {
  if (!Number.isSafeInteger(nowEpochMs) || nowEpochMs < 0)
    throw new Error('INVALID_RESERVATION_CLOCK');
  return `u1-${nowEpochMs}-${randomUUID()}`;
}

export function usageReservationEpoch(reservationId: string): number | null {
  const match =
    /^u1-(0|[1-9]\d*)-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?::[1-9]\d*)?$/.exec(
      reservationId,
    );
  if (!match || match[0] !== reservationId) return null;
  const epoch = Number(match[1]);
  return Number.isSafeInteger(epoch) ? epoch : null;
}
