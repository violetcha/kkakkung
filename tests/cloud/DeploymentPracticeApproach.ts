/** The fixed practice-v1 lanes bring each team's first two slots within hearing range.
 * Count server-applied forward actions, never attempts. No private map enters this driver.
 */
export class DeploymentPracticeApproach {
  private readonly applied: number[];
  private readonly pending = new Map<string, number>();

  constructor(playerCount: number) {
    if (!Number.isSafeInteger(playerCount) || playerCount < 1 || playerCount > 6)
      throw new Error('INVALID_PRACTICE_PARTICIPANTS');
    this.applied = Array.from({ length: playerCount }, () => 0);
  }

  advance(allPublished: boolean, sendForward: (index: number) => string | null): number {
    if (!allPublished) return 0;
    let sent = 0;
    for (let index = 0; index < this.applied.length; index++) {
      if (this.applied[index]! >= 3 || [...this.pending.values()].includes(index)) continue;
      const requestId = sendForward(index);
      if (requestId === null) continue;
      if (this.pending.has(requestId)) throw new Error('DUPLICATE_PRACTICE_REQUEST');
      this.pending.set(requestId, index);
      sent++;
    }
    return sent;
  }

  acknowledge(requestId: string, result: string): void {
    const index = this.pending.get(requestId);
    if (index === undefined) return;
    this.pending.delete(requestId);
    if (result === 'applied') this.applied[index] = this.applied[index]! + 1;
  }

  snapshot(): readonly number[] {
    return [...this.applied];
  }
}
