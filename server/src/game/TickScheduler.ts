/** A single Colyseus timer feeds this scheduler. It never starts its own timer. */
export class TickScheduler {
  private accumulatorMs = 0;

  advance(elapsedMs: number, step: () => void) {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new Error('INVALID_TICK_TIME');
    this.accumulatorMs += elapsedMs;
    if (this.accumulatorMs > 250) throw new Error('TICK_OVERLOAD');
    let count = 0;
    while (this.accumulatorMs >= 50 && count < 4) {
      this.accumulatorMs -= 50;
      step();
      count++;
    }
  }
}
