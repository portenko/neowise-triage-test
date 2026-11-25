import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.mjs";

let server;
let base;

before(async () => {
  server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const post = (body) =>
  fetch(`${base}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const MANUAL = { status: "manual_review", topic: null, draft: null };

test("valid request returns ready with topic and draft", async () => {
  const reply = await post({ text: "Какая цена доставки?" });
  assert.equal(reply.status, 200);
  const body = await reply.json();
  assert.equal(body.status, "ready");
  assert.equal(body.topic, "pricing");
  assert.ok(body.draft.trim().length > 0);
});

for (const [name, payload] of [
  ["empty string", { text: "" }],
  ["whitespace only", { text: "   " }],
  ["missing field", {}],
  ["non-string text", { text: 42 }],
  ["null body", "null"],
  ["broken JSON", "{not json"],
]) {
  test(`invalid input (${name}) returns 400`, async () => {
    const reply = await post(payload);
    assert.equal(reply.status, 400);
    assert.deepEqual(await reply.json(), { status: "invalid_input" });
  });
}

for (const marker of ["[timeout]", "[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
  test(`model failure ${marker} returns manual_review`, async () => {
    const started = Date.now();
    const reply = await post({ text: `Заявка ${marker}` });
    assert.equal(reply.status, 200);
    assert.deepEqual(await reply.json(), MANUAL);
    assert.ok(Date.now() - started < 1_000, "must not wait for the slow model");
  });
}
