export class ConcurrencyLimiter {
  private current = 0;
  private queue: Array<() => void> = [];

  constructor(private max: number = 32) {}

  async acquire(): Promise<() => void> {
    if (this.current < this.max) {
      this.current++;
      return this.createRelease();
    }

    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        this.current++;
        resolve(this.createRelease());
      });
    });
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.current--;
      const next = this.queue.shift();
      if (next) next();
    };
  }
}
