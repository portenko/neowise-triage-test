import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { classify } from "./mock-ai.mjs";

const html = await readFile(new URL("./index.html", import.meta.url));

export const MODEL_TIMEOUT_MS = 300;
const TOPICS = new Set(["delivery", "pricing", "other"]);
const MANUAL_REVIEW = { status: "manual_review", topic: null, draft: null };

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

// Returns the validated text or null for any invalid input.
async function readText(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const text = body?.text;
    return typeof text === "string" && text.trim() !== "" ? text : null;
  } catch {
    return null;
  }
}

// Calls the model with a hard time limit. Never throws: any failure means null.
async function askModel(text) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
  const aborted = new Promise((_, reject) =>
    controller.signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true }),
  );
  try {
    const raw = await Promise.race([classify(text, { signal: controller.signal }), aborted]);
    const result = JSON.parse(raw);
    const { topic, draft } = result ?? {};
    if (!TOPICS.has(topic)) return null;
    if (typeof draft !== "string" || draft.trim() === "") return null;
    return { topic, draft };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function handleTriage(request, response) {
  const text = await readText(request);
  if (text === null) return json(response, 400, { status: "invalid_input" });
  const result = await askModel(text);
  if (result === null) return json(response, 200, MANUAL_REVIEW);
  return json(response, 200, { status: "ready", ...result });
}

export function createApp() {
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    if (request.method !== "POST" || request.url !== "/api/triage") {
      return json(response, 404, { status: "not_found" });
    }
    try {
      await handleTriage(request, response);
    } catch {
      json(response, 500, { status: "server_error" });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createApp().listen(Number(process.env.PORT || 3000), "127.0.0.1");
}
