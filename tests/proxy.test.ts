import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { originAllowed } from "../src/api/origin.js";

test("server trusts one proxy; Express protocol honors HTTPS forwarding for the origin guard", async (context) => {
  assert.match(await readFile("src/api/server.ts", "utf8"), /app\.set\("trust proxy", 1\)/u);
  const moduleName = "express";
  let express;
  try { express = (await import(moduleName)).default; }
  catch { context.skip("Express is installed in the app image; absent from this offline checkout"); return; }
  const app = express(); app.set("trust proxy", 1);
  const request = Object.create(app.request);
  request.app = app; request.connection = { remoteAddress: "127.0.0.1", encrypted: false };
  request.headers = { host: "challengelens.example", origin: "https://challengelens.example", "x-forwarded-proto": "https" };
  assert.equal(request.protocol, "https"); assert.equal(originAllowed(request), true);
  app.set("trust proxy", false); assert.equal(request.protocol, "http"); assert.equal(originAllowed(request), false);
  app.set("trust proxy", 1); request.headers.origin = "https://evil.example"; assert.equal(originAllowed(request), false);
  request.headers.origin = "https://challengelens.example"; request.headers["sec-fetch-site"] = "cross-site"; assert.equal(originAllowed(request), false);
});
