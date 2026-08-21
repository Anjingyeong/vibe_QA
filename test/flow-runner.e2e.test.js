import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startFlowFixture } from "./fixture/flow-service.js";
import { runFlowBrowserBenchmark } from "../src/benchmark/run-flow-browser.js";

test("local fixture exercises lifecycle without report mutations and cleans rooms", async () => {
  const fixture = await startFlowFixture();
  const output = await mkdtemp(path.join(tmpdir(), "flow-runner-"));
  try {
    await writeFile(path.join(output, "stale-room-code.txt"), "ABC234", "utf8");
    const result = await runFlowBrowserBenchmark({ target: fixture.url, allowHosts: ["localhost"],
      allowPrivateForTesting: true, browser: "chromium", runs: 1, output });
    assert.equal(result.passed, true);
    assert.equal(fixture.receipt.creates, 2);
    assert.equal(fixture.receipt.joins, 2);
    assert.equal(fixture.receipt.deletes, 2);
    assert.equal(fixture.receipt.reportMutations, 0);
    assert.equal(fixture.receipt.rooms.size, 0);
    const artifact = await readFile(path.join(output, "aggregate.json"), "utf8");
    assert.doesNotMatch(artifact, /ABC234|fixture-player-token/);
    await assert.rejects(access(path.join(output, "stale-room-code.txt")));
    assert.equal(result.runs[0].profiles.desktop.actorContextsClosed, true);
  } finally {
    await fixture.close();
    await rm(output, { recursive: true, force: true });
  }
});
