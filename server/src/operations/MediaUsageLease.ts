import type { Generation } from '../media/MediaGenerationRegistry.js';
import type { UsageBudget } from './UsageBudget.js';
import { createUsageReservationId } from './UsageReservationId.js';
import { ownedMediaTargets } from './SplitMediaOwnership.js';
import type { UsageRequest } from './UsageCheckpoint.js';

type Lease = {
  id: string;
  roomName: string;
  matchId: string;
  until: number;
  sequence: number;
  reservations: string[];
  pending: Promise<boolean> | null;
  retiring: boolean;
  profile: string;
  units: number;
  bytesPerMinute: number;
};

/** Conservative estimates, never Cloud billing. Six participants, five receivers per publisher,
 * 100 kbps face + 64 kbps audio, 100% transport/retry margin; first five minutes then minute slices.
 * A slice must be durable before its connection time is used. Unconfirmed slices stay reserved.
 */
export class MediaUsageLease {
  private readonly leases = new Map<string, Lease>();
  constructor(
    private readonly budget: UsageBudget,
    private readonly now: () => number,
  ) {}

  private leaseFor(generation: Generation): Lease {
    const split = generation.splitOwnership;
    // Keep the durable UsageRequest's existing six-slot block format. Split generations
    // reserve enough blocks for both originals and every possible clone, at the SAME time.
    const units = split ? Math.ceil(ownedMediaTargets(generation).length / 6) : 1;
    if (units < 1 || units > 2) throw new Error('INVALID_LEASE_CAPACITY');
    const profile = JSON.stringify([
      generation.request.matchId,
      generation.request.mediaInstanceId,
      split ? [split.faceRoomName, split.receiverRoomNames] : null,
    ]);
    const bytesPerMinute =
      (164_000 / 8) * (split ? Math.max(1, split.receiverRoomNames.length) : 30) * 60;
    let lease = this.leases.get(generation.roomName);
    if (!lease) {
      lease = {
        id: createUsageReservationId(this.now()),
        roomName: generation.roomName,
        matchId: generation.request.matchId,
        until: this.now(),
        sequence: 0,
        reservations: [],
        pending: null,
        retiring: false,
        profile,
        units,
        bytesPerMinute,
      };
      this.leases.set(generation.roomName, lease);
    }
    if (lease.profile !== profile) throw new Error('LEASE_OWNERSHIP_CHANGED');
    generation.reservationId = lease.id;
    return lease;
  }

  prepareReservation(generation: Generation): readonly UsageRequest[] {
    const lease = this.leaseFor(generation);
    if (!generation.splitOwnership || lease.sequence !== 0 || lease.pending || lease.retiring)
      throw new Error('RESERVATION_ALREADY_STARTED');
    return Array.from({ length: lease.units }, (_, unit) => this.request(lease, unit, 5));
  }

  reserve(generation: Generation): Promise<boolean> {
    let lease: Lease;
    try {
      lease = this.leaseFor(generation);
    } catch (error) {
      return Promise.reject(error);
    }
    if (lease.retiring) return Promise.resolve(false);
    if (lease.until - this.now() > 60_000) return Promise.resolve(true);
    if (lease.pending) return lease.pending;
    const current = lease;
    current.pending = this.reserveSlice(current).finally(() => {
      current.pending = null;
    });
    return current.pending;
  }

  private request(current: Lease, sequence: number, minutes: number): UsageRequest {
    return {
      reservationId: sequence === 0 ? current.id : `${current.id}:${sequence}`,
      matchId: current.matchId,
      purpose: 'public',
      slots: 6,
      expectedMinutes: minutes,
      expectedBytes: Math.ceil((current.bytesPerMinute * minutes) / current.units),
      margin: 1,
    };
  }

  private async reserveSlice(current: Lease): Promise<boolean> {
    const minutes = current.sequence === 0 ? 5 : 1;
    let reserved = 0;
    for (let unit = 0; unit < current.units; unit++) {
      const id = current.sequence === 0 ? current.id : `${current.id}:${current.sequence}`;
      const result = await this.budget.reserve(this.request(current, current.sequence, minutes));
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
        if (reserved > 0) {
          current.retiring = true;
          throw new Error('PARTIAL_RESERVATION_UNCONFIRMED');
        }
        return false;
      }
      current.sequence++;
      current.reservations.push(id);
      reserved++;
    }
    current.until = Math.max(current.until, this.now()) + minutes * 60_000;
    return true;
  }

  remaining(generation: Generation): number {
    return (this.leases.get(generation.roomName)?.until ?? 0) - this.now();
  }
  abandonUnreserved(generation: Generation): void {
    const lease = this.leases.get(generation.roomName);
    if (
      !lease ||
      lease.id !== generation.reservationId ||
      lease.pending ||
      lease.reservations.length ||
      this.budget
        .snapshot()
        .reservations.some(
          ({ request }) =>
            request.reservationId === lease.id || request.reservationId.startsWith(lease.id + ':'),
        )
    )
      throw new Error('LEASE_NOT_EMPTY');
    lease.retiring = true;
    this.leases.delete(generation.roomName);
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
