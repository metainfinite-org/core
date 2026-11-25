import { MemoryLogStore } from "@ev/log";
import { logStoreContract } from "./contract";

logStoreContract("memory", async () => new MemoryLogStore());
