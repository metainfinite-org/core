import type { LogWriter } from "./writer";

/** Seals the open block on a timer (07 §2). The interval comes from deployment.yml. */
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
      this.writer.sealBlock().catch(this.onError);
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
