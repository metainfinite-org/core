// JSON-lines export of the log (07 §2): blocks, then each block's txs, with a
// published batch's events right after its publish_batch tx. Replay order, so
// an importer can apply lines one by one. The later import into the real
// system canonicalizes (02 §4).

import { blockToLine, eventToJson, txToLine, type LogLine } from "@ev/core";
import type { LogReader } from "./store";

export async function* exportLog(log: LogReader): AsyncIterable<LogLine> {
  for await (const block of log.blocks()) {
    yield blockToLine(block);
    for (const tx of await log.txsOfBlock(block.number)) {
      yield txToLine(tx);
      if (tx.type === "publish_batch") {
        const events = [...(await log.batchEvents(tx.payload.app, tx.payload.batch))];
        events.sort((a, b) => (a.address.user !== b.address.user ? (a.address.user < b.address.user ? -1 : 1) : a.address.seq < b.address.seq ? -1 : a.address.seq > b.address.seq ? 1 : 0));
        for (const e of events) yield { kind: "event", ...eventToJson(e) };
      }
    }
  }
}
