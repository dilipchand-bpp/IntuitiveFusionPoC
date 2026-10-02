/** Injectable time source. Deadlines, alert dates and session timeouts must never call Date.now() directly. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Test clock that only moves when told to. */
export class ManualClock implements Clock {
  private t: number;
  constructor(start: Date | string) {
    this.t = new Date(start).getTime();
  }
  now(): Date {
    return new Date(this.t);
  }
  set(to: Date | string): void {
    this.t = new Date(to).getTime();
  }
  advanceMs(ms: number): void {
    this.t += ms;
  }
  advanceDays(days: number): void {
    this.advanceMs(days * 86_400_000);
  }
}
