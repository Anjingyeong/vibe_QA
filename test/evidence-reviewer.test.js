import test from "node:test";
import assert from "node:assert/strict";
import { reviewRuns } from "../src/reviewer/evidence-reviewer.js";

function valid(signature) {
  return {
    signature,
    severity: "major",
    title: "Example",
    reproduction: "Do a thing.",
    expected: "Expected.",
    actual: "Actual.",
    evidence: [{ type: "network", detail: "GET / -> 500" }],
  };
}

test("reviewer confirms only evidence-backed repeated findings", () => {
  const result = reviewRuns([
    { findings: [valid("a"), { ...valid("bad"), evidence: [] }] },
    { findings: [valid("a")] },
    { findings: [valid("a")] },
  ]);

  assert.equal(result.confirmed.length, 1);
  assert.equal(result.confirmed[0].signature, "a");
  assert.equal(result.confirmed[0].reproducibility, 1);
  assert.equal(result.rejected.length, 1);
});

test("reviewer rejects browser findings without screenshot evidence", () => {
  const browserFinding = valid("browser:console-error:desktop");
  const result = reviewRuns([
    { findings: [browserFinding] },
    { findings: [browserFinding] },
  ]);
  assert.equal(result.confirmed.length, 0);
  assert.equal(result.rejected.length, 2);
});

test("reviewer rejects repeated signatures whose identity changes between runs", () => {
  const result = reviewRuns([
    { findings: [valid("same-signature")] },
    { findings: [{ ...valid("same-signature"), severity: "critical" }] },
  ]);
  assert.equal(result.confirmed.length, 0);
  assert.equal(result.provisional.length, 1);
  assert.match(result.rejected.at(-1).reasons[0], /inconsistent/);
});
