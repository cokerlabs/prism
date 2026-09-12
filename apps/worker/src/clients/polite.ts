import { DataSourceUnavailableError } from "./errors";

export const PRISM_USER_AGENT =
  "Prism/0.1 (+https://cokerlabs.dev/in/prism; respectful bot)";

export const MIN_429_SLEEP_MS = 200;
export const MAX_BACKOFF_MS = 30_000;
export const DEFAULT_MAX_RETRIES = 3;

export type HostPolicy = {
  minIntervalMs: number;
  maxPerWindow: number;
  windowMs: number;
};

export const DEFAULT_HOST_POLICY: HostPolicy = {
  minIntervalMs: 500,
  maxPerWindow: 1,
  windowMs: 500,
};

/** Published limits plus headroom. FRED ≈2/s; BLS well under 50/10s. */
export const HOST_POLICY: Record<string, HostPolicy> = {
  "api.stlouisfed.org": {
    minIntervalMs: 500,
    maxPerWindow: 1,
    windowMs: 500,
  },
  "api.bls.gov": {
    minIntervalMs: 2000,
    maxPerWindow: 5,
    windowMs: 10_000,
  },
  "api.census.gov": {
    minIntervalMs: 500,
    maxPerWindow: 2,
    windowMs: 1000,
  },
};

export type PoliteClock = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

export function realClock(): PoliteClock {
  return {
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

export function createFakeClock(start = 0): PoliteClock & {
  sleeps: number[];
} {
  let current = start;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => current,
    sleep: async (ms) => {
      sleeps.push(ms);
      current += ms;
    },
  };
}

export class RateGate {
  private inflight = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly sentAt = new Map<string, number[]>();

  constructor(
    private readonly clock: PoliteClock,
    private readonly concurrency = 1,
    private readonly policy: Record<string, HostPolicy> = HOST_POLICY,
  ) {}

  async acquire(host: string): Promise<void> {
    await this.acquireSlot();
    await this.waitForHost(host);
    this.record(host);
  }

  release(): void {
    this.inflight = Math.max(0, this.inflight - 1);
    const next = this.waiters.shift();
    if (next) {
      this.inflight += 1;
      next();
    }
  }

  private policyFor(host: string): HostPolicy {
    return this.policy[host] ?? DEFAULT_HOST_POLICY;
  }

  private acquireSlot(): Promise<void> {
    if (this.inflight < this.concurrency) {
      this.inflight += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private async waitForHost(host: string): Promise<void> {
    const policy = this.policyFor(host);
    const now = this.clock.now();
    const times = (this.sentAt.get(host) ?? []).filter(
      (stamp) => now - stamp < policy.windowMs,
    );
    this.sentAt.set(host, times);

    let wait = 0;
    const last = times.at(-1);
    if (last !== undefined) {
      wait = Math.max(wait, policy.minIntervalMs - (now - last));
    }
    if (times.length >= policy.maxPerWindow) {
      const oldest = times[0];
      if (oldest !== undefined) {
        wait = Math.max(wait, policy.windowMs - (now - oldest));
      }
    }
    if (wait > 0) {
      await this.clock.sleep(wait);
    }
  }

  private record(host: string): void {
    const times = this.sentAt.get(host) ?? [];
    times.push(this.clock.now());
    this.sentAt.set(host, times);
  }
}

export function parseRetryAfter(
  value: string | null,
  nowMs: number,
): number | undefined {
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.max(seconds * 1000, MIN_429_SLEEP_MS);
  }
  const date = Date.parse(value);
  if (Number.isFinite(date)) {
    return Math.max(date - nowMs, MIN_429_SLEEP_MS);
  }
  return undefined;
}

export function backoffMs(attempt: number, random: () => number): number {
  const base = 500 * 2 ** attempt;
  const jitter = Math.floor(random() * 250);
  return Math.min(base + jitter, MAX_BACKOFF_MS);
}

export type PoliteFetchInit = {
  fetch: typeof fetch;
  clock?: PoliteClock;
  gate?: RateGate;
  random?: () => number;
  maxRetries?: number;
  source?: string;
};

function hostnameOf(input: RequestInfo | URL): string {
  if (input instanceof URL) {
    return input.hostname;
  }
  if (typeof input === "string") {
    return new URL(input).hostname;
  }
  return new URL(input.url).hostname;
}

function withUserAgent(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);
  if (!headers.has("User-Agent")) {
    headers.set("User-Agent", PRISM_USER_AGENT);
  }
  return { ...init, headers };
}

export async function politeFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  options: PoliteFetchInit,
): Promise<Response> {
  const clock = options.clock ?? realClock();
  const gate = options.gate ?? new RateGate(clock);
  const random = options.random ?? Math.random;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const host = hostnameOf(input);
  const source = options.source ?? host;
  const requestInit = withUserAgent(init);

  let lastResponse: Response | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    await gate.acquire(host);
    try {
      lastResponse = await options.fetch(input, requestInit);
    } catch {
      gate.release();
      throw new DataSourceUnavailableError(source);
    }
    gate.release();

    if (lastResponse.status !== 429) {
      return lastResponse;
    }

    if (attempt === maxRetries) {
      break;
    }

    const retryAfter = parseRetryAfter(
      lastResponse.headers.get("Retry-After"),
      clock.now(),
    );
    await clock.sleep(retryAfter ?? backoffMs(attempt, random));
  }

  throw new DataSourceUnavailableError(source);
}
