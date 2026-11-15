import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PublicHttp, PublicRequest } from "./http.js";

interface Envelope {
  cacheVersion: 1;
  url: string;
  method: string;
  requestBody: string | null;
  retrievedAt: string;
  responseText: string;
}

export interface CacheResult<T> {
  value: T;
  cacheFile: string;
}

export class ResponseCache {
  private readonly inRun = new Map<string, CacheResult<string>>();

  constructor(
    private readonly http: PublicHttp,
    private readonly options: { offline: boolean; refresh: boolean },
  ) {}

  async text(namespace: string, url: string, request: PublicRequest = {}): Promise<CacheResult<string>> {
    const method = request.method ?? "GET";
    const requestBody = request.body ?? null;
    const key = createHash("sha256")
      .update(JSON.stringify({ cacheVersion: 1, url, method, requestBody }))
      .digest("hex");
    const cacheFile = `data/raw/${namespace}/${key}.json`;
    const inRun = this.inRun.get(cacheFile);
    if (inRun) return inRun;
    if (!this.options.refresh) {
      let text: string | null = null;
      try {
        text = await readFile(cacheFile, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw new Error(`Cannot read public response cache: ${cacheFile}`);
        }
      }
      if (text !== null) {
        let envelope: Envelope;
        try {
          envelope = JSON.parse(text) as Envelope;
          if (envelope.cacheVersion !== 1 || envelope.url !== url || envelope.method !== method ||
              envelope.requestBody !== requestBody || typeof envelope.responseText !== "string") {
            throw new Error();
          }
        } catch {
          throw new Error(`Invalid response cache: ${cacheFile}; use --refresh in collect to replace it.`);
        }
        const result = { value: envelope.responseText, cacheFile };
        this.inRun.set(cacheFile, result);
        return result;
      }
    }
    if (this.options.offline) throw new Error(`Offline cache miss: ${cacheFile}`);

    const responseText = await this.http.text(url, request);
    const envelope: Envelope = {
      cacheVersion: 1, url, method, requestBody,
      retrievedAt: new Date().toISOString(), responseText,
    };
    await mkdir(dirname(cacheFile), { recursive: true });
    const temporary = `${cacheFile}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
    await rename(temporary, cacheFile);
    const result = { value: responseText, cacheFile };
    this.inRun.set(cacheFile, result);
    return result;
  }

  async json<T>(namespace: string, url: string, request: PublicRequest = {}): Promise<CacheResult<T>> {
    const result = await this.text(namespace, url, request);
    try {
      return { value: JSON.parse(result.value) as T, cacheFile: result.cacheFile };
    } catch {
      throw new Error(`Response is not valid JSON; inspect ${result.cacheFile}`);
    }
  }
}
