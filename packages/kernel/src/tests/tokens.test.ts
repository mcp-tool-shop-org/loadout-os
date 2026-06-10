import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { estimateTokens } from "../tokens.js";

describe("estimateTokens", () => {
  it("estimates ~1 token per 4 chars", () => {
    assert.equal(estimateTokens("abcd"), 1);
    assert.equal(estimateTokens("abcde"), 2);
    assert.equal(estimateTokens(""), 0);
  });

  it("handles long text", () => {
    const text = "a".repeat(400);
    assert.equal(estimateTokens(text), 100);
  });
});
