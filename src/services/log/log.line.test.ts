import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLogTimestamp,
  parseChunkToLogLine,
} from "./log.service.js";

const INSTANT_ISO = "2026-08-09T09:28:08.614Z";
const INSTANT = Date.parse(INSTANT_ISO);

describe("normalizeLogTimestamp", () => {
  test("canonical epoch millis pass through untouched", () => {
    assert.equal(normalizeLogTimestamp(INSTANT), INSTANT);
  });

  test("legacy ISO-8601 strings resolve to the same instant", () => {
    assert.equal(normalizeLogTimestamp(INSTANT_ISO), INSTANT);
  });

  test("offsets in legacy strings are honored (same instant, different zone)", () => {
    // 11:28:08.614 at +02:00 === 09:28:08.614Z
    assert.equal(normalizeLogTimestamp("2026-08-09T11:28:08.614+02:00"), INSTANT);
  });

  test("missing or garbage timestamps fall back to receipt time, never NaN", () => {
    for (const bad of [undefined, null, "not-a-date", NaN, {}, true]) {
      const before = Date.now();
      const got = normalizeLogTimestamp(bad);
      assert.ok(got >= before && got <= Date.now(), `fallback out of window for ${String(bad)}`);
    }
  });

  test("explicit fallback instant is used when provided", () => {
    assert.equal(normalizeLogTimestamp(undefined, 12345), 12345);
  });
});

describe("parseChunkToLogLine", () => {
  test("worker emission instant survives parsing exactly", () => {
    const line = parseChunkToLogLine("done\n", INSTANT);
    assert.equal(line.ts, INSTANT);
    assert.equal(line.msg, "done");
  });

  test("legacy string instant from old backlog entries is preserved", () => {
    const line = parseChunkToLogLine("done\n", INSTANT_ISO);
    assert.equal(line.ts, INSTANT);
  });

  test("absent instant is stamped at receipt", () => {
    const before = Date.now();
    const line = parseChunkToLogLine("hello\n");
    assert.ok(line.ts >= before && line.ts <= Date.now());
  });

  test("level detection behavior is unchanged", () => {
    assert.equal(parseChunkToLogLine("boom: error happened\n", INSTANT).level, "error");
    assert.equal(parseChunkToLogLine("all good\n", INSTANT).level, "info");
  });

  test("empty chunks stay skippable", () => {
    assert.equal(parseChunkToLogLine("\n\n", INSTANT).msg, "");
  });

  test("SSE JSON round-trip keeps ts numeric (no string coercion)", () => {
    const line = parseChunkToLogLine("x\n", INSTANT);
    const revived = JSON.parse(`data: ${JSON.stringify(line)}`.replace(/^data: /, ""));
    assert.equal(revived.ts, INSTANT);
    assert.equal(typeof revived.ts, "number");
  });
});
