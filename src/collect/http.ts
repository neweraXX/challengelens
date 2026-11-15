import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fetch, ProxyAgent } from "undici";
import { REQUEST_DELAY_MS } from "../../config/pilot.js";

export interface PublicRequest {
  method?: "GET" | "POST";
  body?: string;
}

class HttpFailure extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status: number | null = null,
    readonly retryAfterMs = 0,
  ) {
    super(message);
  }
}

function isPolymarket(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return host === "polymarket.com" || host.endsWith(".polymarket.com");
}

function validateProxy(value: string): string {
  try {
    const proxy = new URL(value);
    // URL normalizes an explicit :80 to the default empty port.
    if (proxy.protocol !== "http:" || !proxy.hostname) throw new Error();
    if (proxy.pathname !== "/" || proxy.search || proxy.hash) throw new Error();
    return proxy.href;
  } catch {
    // Never let a URL parser exception expose proxy credentials.
    throw new Error("Invalid proxy configuration; expected an HTTP proxy with a host and port.");
  }
}

export function safeMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : "Unexpected failure";
  for (const name of [
    "POLYMARKET_PROXY", "SERV_API_KEY", "REPPO_API_KEY", "OPENROUTER_API_KEY",
  ]) {
    const supplied = process.env[name];
    for (const secret of new Set([supplied, supplied?.trim()])) {
      if (secret) message = message.split(secret).join("[redacted]");
    }
  }
  // Also covers credentials from the optional proxy list, without printing it.
  return message.replace(/https?:\/\/[^\s<>"']+@[^\s<>"']+/giu, "[redacted proxy URL]");
}

// All collection HTTP goes through here, including redirects. No global proxy
// environment is used: Goldsky/GitHub stay direct even when a proxy is configured.
export class PublicHttp {
  constructor(private readonly options: { quiet?: boolean; attempts?: number; timeoutMs?: number; redirects?: number } = {}) {}
  private proxies: string[] | null = null;
  private proxyIndex = 0;
  private readonly agents = new Map<string, ProxyAgent>();
  private lastRequestAt = 0;

  private async loadProxies(): Promise<string[]> {
    if (this.proxies !== null) return this.proxies;
    const proxies: string[] = [];
    const primary = process.env.POLYMARKET_PROXY?.trim();
    if (primary) proxies.push(validateProxy(primary));

    const listPath = process.env.POLYMARKET_PROXY_LIST?.trim();
    if (listPath) {
      const absolute = resolve(listPath);
      if (!absolute.startsWith(`${resolve(process.cwd())}${sep}`)) {
        throw new Error("POLYMARKET_PROXY_LIST must be a file inside the mounted project directory.");
      }
      let contents: string;
      try {
        contents = await readFile(absolute, "utf8");
      } catch {
        throw new Error("Cannot read POLYMARKET_PROXY_LIST inside the project mount.");
      }
      for (const line of contents.split(/\r?\n/u)) {
        const entry = line.trim();
        if (!entry || entry.startsWith("#")) continue;
        const parts = /^([^:\s]+):(\d+):([^:]+):(.+)$/u.exec(entry);
        if (!parts) throw new Error("Invalid proxy-list entry; expected host:port:user:pass.");
        try {
          const proxy = new URL(`http://${parts[1]}:${parts[2]}`);
          proxy.username = parts[3]!;
          proxy.password = parts[4]!;
          proxies.push(validateProxy(proxy.href));
        } catch {
          throw new Error("Invalid proxy-list entry; check its format without logging credentials.");
        }
      }
      if (proxies.length === 0) throw new Error("Configured proxy list is empty; refusing direct fallback.");
    }
    this.proxies = [...new Set(proxies)];
    return this.proxies;
  }

  private async dispatcherFor(url: URL): Promise<ProxyAgent | undefined> {
    if (!isPolymarket(url)) return undefined;
    const proxies = await this.loadProxies();
    const proxy = proxies[this.proxyIndex];
    if (!proxy) return undefined; // Direct is allowed only when no proxy is configured.
    let agent = this.agents.get(proxy);
    if (!agent) {
      try {
        agent = new ProxyAgent(proxy);
      } catch {
        throw new Error("Could not initialize the configured Polymarket proxy.");
      }
      this.agents.set(proxy, agent);
    }
    return agent;
  }

  private async throttle(): Promise<void> {
    const remaining = REQUEST_DELAY_MS - (Date.now() - this.lastRequestAt);
    if (remaining > 0) await delay(remaining);
    this.lastRequestAt = Date.now();
  }

  async text(address: string, request: PublicRequest = {}): Promise<string> {
    let url = new URL(address);
    let method = request.method ?? "GET";
    let body = request.body;

    for (let redirects = 0; redirects <= (this.options.redirects ?? 5); redirects += 1) {
      if (url.protocol !== "https:") throw new Error("Collection URLs must use HTTPS.");
      if (url.username || url.password) throw new Error("Credentials in collection URLs are forbidden.");
      let redirected = false;
      for (let attempt = 0; attempt < (this.options.attempts ?? 4); attempt += 1) {
        const dispatcher = await this.dispatcherFor(url);
        await this.throttle();
        const label = `${url.hostname}${url.pathname}`; // No query or credentials.
        try {
          const response = await fetch(url, {
            method,
            ...(body === undefined ? {} : { body }),
            headers: body === undefined
              ? { accept: "application/json, text/plain" }
              : { accept: "application/json", "content-type": "application/json" },
            ...(dispatcher ? { dispatcher } : {}),
            redirect: "manual",
            signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
          });
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get("location");
            await response.body?.cancel();
            if (!location) throw new HttpFailure(`HTTP ${label}: redirect without Location`, false);
            let next: URL;
            try {
              next = new URL(location, url);
            } catch {
              throw new HttpFailure(`HTTP ${label}: invalid redirect`, false);
            }
            if (next.username || next.password) {
              throw new HttpFailure(`HTTP ${label}: credentials in redirect are forbidden`, false);
            }
            if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
              method = "GET";
              body = undefined;
            }
            // Re-evaluate the destination host and proxy on the next iteration.
            url = next;
            redirected = true;
            break;
          }
          // GraphQL validation errors can use HTTP 400. Preserve their public
          // body so the Goldsky caller can print the field errors and schema.
          if (response.status === 400 && url.hostname === "api.goldsky.com" && method === "POST") {
            return await response.text();
          }
          if (!response.ok) {
            const retryAfter = response.headers.get("retry-after");
            const seconds = Number(retryAfter);
            const parsedDate = retryAfter ? Date.parse(retryAfter) : NaN;
            const wait = Number.isFinite(seconds) && seconds > 0
              ? seconds * 1_000
              : Number.isFinite(parsedDate) ? Math.max(0, parsedDate - Date.now()) : 0;
            await response.body?.cancel();
            throw new HttpFailure(
              `HTTP ${label}: status ${response.status}`,
              response.status === 429 || response.status >= 500,
              response.status,
              Math.min(wait, 30_000),
            );
          }
          return await response.text();
        } catch (error) {
          // Do not print undici errors, causes, stacks, headers or proxy URLs.
          const failure = error instanceof HttpFailure
            ? error
            : new HttpFailure(`HTTP ${label}: network error or timeout`, true);
          if (!failure.retryable || attempt === (this.options.attempts ?? 4) - 1) throw failure;
          if (isPolymarket(url) && (failure.status === null || failure.status === 429)) {
            const proxies = await this.loadProxies();
            if (proxies.length > 1) this.proxyIndex = (this.proxyIndex + 1) % proxies.length;
          }
          const wait = Math.max(1_000 * 2 ** attempt, failure.retryAfterMs);
          if (!this.options.quiet) console.warn(`${failure.message}; retry ${attempt + 2}/4 after ${wait} ms`);
          await delay(wait);
        }
      }
      if (!redirected) break;
    }
    throw new Error("Too many HTTP redirects (maximum 5).");
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.agents.values()].map((agent) => agent.close()));
  }
}
