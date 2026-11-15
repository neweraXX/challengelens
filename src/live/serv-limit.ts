import { LiveError } from "../demo/live.js";

/** One process-wide start limit shared by interactive checks and the background desk. */
export class ServSlots {
  private last = -Infinity;
  constructor(private readonly now = () => performance.now(), private readonly pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))) {}
  reserve() {
    const left = 3000 - (this.now() - this.last);
    if (left > 0) throw new LiveError("One SERV call every 3 seconds globally. Retry shortly.", 429, Math.ceil(left / 1000));
    this.last = this.now();
  }
  async wait() {
    for (;;) {
      const left = 3000 - (this.now() - this.last);
      if (left > 0) { await this.pause(left); continue; }
      this.reserve(); return;
    }
  }
}
export const servSlots = new ServSlots();
