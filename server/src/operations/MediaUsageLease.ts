import { randomUUID } from 'node:crypto';
import type { Generation } from '../media/MediaGenerationRegistry.js';
import type { UsageBudget } from './UsageBudget.js';

/** Conservative estimates, never Cloud billing. Six participants, five receivers per publisher,
 * 100 kbps face + 64 kbps audio, 100% transport/retry margin; first five minutes then minute slices.
 * A slice must be durable before its connection time is used. Unconfirmed slices stay reserved.
 */
export class MediaUsageLease {
  private readonly leases = new Map<
    string,
    {
      id: string;
      roomName: string;
      matchId: string;
      until: number;
      sequence: number;
      reservations: string[];
      pending: Promise<boolean> | null;
      retiring: boolean;
    }
  >();
  constructor(
    private readonly budget: UsageBudget,
    private readonly now: () => number,
  ) {}

  reserve(generation: Generation): Promise<boolean> {
    let lease = this.leases.get(generation.roomName);
    if (!lease) {
      lease = {
        id: randomUUID(),
        roomName: generation.roomName,
        matchId: generation.request.matchId,
        until: this.now(),
        sequence: 0,
        reservations: [],
        pending: null,
        retiring: false,
      };
      this.leases.set(generation.roomName, lease);
    }
    generation.reservationId = lease.id;
    if (lease.retiring) return Promise.resolve(false);
    if (lease.until - this.now() > 60_000) return Promise.resolve(true);
    if (lease.pending) return lease.pending;
    const current = lease;
    const minutes = current.sequence === 0 ? 5 : 1;
    const id = current.sequence === 0 ? current.id : `${current.id}:${current.sequence}`;
    current.pending = this.budget
      .reserve({
        reservationId: id,
        matchId: current.matchId,
        purpose: 'public',
        slots: 6,
        expectedMinutes: minutes,
        expectedBytes: Math.ceil((164_000 / 8) * 30 * minutes * 60),
        margin: 1,
      })
      .then((result) => {
        if (result.status === 'rejected') {
          const persisted = this.budget
            .snapshot()
            .reservations.some((reservation) => reservation.request.reservationId === id);
          if (persisted || result.code === 'STORAGE_FAILURE') {
            // Admission may close after the reservation reached disk. Preserve
            // its identity for the issuer's unresolved/retirement path instead
            // of treating the attempt as an ordinary rejection with no effects.
            current.reservations.push(id);
            current.sequence++;
            current.retiring = true;
            throw new Error('RESERVATION_UNCONFIRMED');
          }
          return false;
        }
        current.until = Math.max(current.until, this.now()) + minutes * 60_000;
        current.sequence++;
        current.reservations.push(id);
        return true;
      })
      .finally(() => {
        current.pending = null;
      });
    return current.pending;
  }

  remaining(generation: Generation): number {
    return (this.leases.get(generation.roomName)?.until ?? 0) - this.now();
  }
  async markRetiring(roomName: string): Promise<void> {
    const lease = this.leases.get(roomName);
    if (!lease) return;
    lease.retiring = true;
    if (lease.pending) await lease.pending;
    for (const id of lease.reservations) {
      if (!(await this.budget.markRetiring(id)) || !(await this.budget.markRemoteConfirmed(id)))
        throw new Error('RESERVATION_WRITE_FAILED');
    }
    if (this.leases.get(roomName) === lease) this.leases.delete(roomName);
  }
}
