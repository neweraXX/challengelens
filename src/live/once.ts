import { LiveDesk } from "./runtime.js";
const desk = new LiveDesk();
try { console.log(JSON.stringify((await desk.cycle()).totals)); }
catch (error) { console.error("Live cycle failed:", error instanceof Error ? `${error.name}: ${error.message.slice(0, 300)}` : "unknown error"); if (process.env.LIVE_DEBUG === "1" && error instanceof Error) console.error(error.stack?.split("\n").slice(0, 8).join("\n")); process.exitCode = 1; }
finally { await desk.close(); }
