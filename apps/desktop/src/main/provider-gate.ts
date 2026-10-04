import type { JevProvider } from "../../../../packages/providers/src/jev.ts";
export class ProviderGate {
  private enabled = false;
  private requests = 0;
  private inputTokens = 0;
  private active = 0;
  constructor(privateProvider: JevProvider | undefined, limit = 100) {
    this.backend = privateProvider;
    this.limit = limit;
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw Error("Invalid budget");
  }
  private backend: JevProvider | undefined;
  private limit: number;
  get configured() {
    return !!this.backend;
  }
  get counters() {
    return {
      requests: this.requests,
      inputTokens: this.inputTokens,
      inFlight: this.active,
    };
  }
  setEnabled(value: boolean) {
    if (value && !this.backend) throw Error("Provider unavailable");
    this.enabled = value;
  }
  provider(): JevProvider | undefined {
    if (!this.enabled || !this.backend) return undefined;
    return {
      classify: async (text, signal) => {
        if (!this.enabled || this.requests >= this.limit || this.active >= 2)
          throw Error("Provider budget unavailable");
        signal?.throwIfAborted();
        this.requests++;
        this.active++;
        try {
          const result = await this.backend!.classify(text, signal);
          this.inputTokens += result.inputTokens;
          return result;
        } finally {
          this.active--;
        }
      },
    };
  }
}
