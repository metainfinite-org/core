import type { LogWriter } from "./writer";

/**
 * Closes the open block on a timer (07 §2); the interval comes from deployment.yml.
 * Blocks open lazily on the next write, so an idle node adds no empty blocks.
 */
export class BlockProducer {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly writer: LogWriter,
    private readonly intervalMs: number,
    private readonly onError: (err: unknown) => void = (err) => console.error("block producer:", err),
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.writer.closeBlock().catch(this.onError);
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
