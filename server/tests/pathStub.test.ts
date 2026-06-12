import assert from "node:assert/strict";
import path, { dirname, join } from "../../client/src/sync/stubs/path.js";

assert.equal(join("/", "data", "tracking.json"), "/data/tracking.json");
assert.equal(dirname("/data/tracking.json"), "/data");
assert.equal(dirname("data/cache/tracking.json"), "data/cache");
assert.equal(typeof path.dirname, "function");
assert.equal(path.dirname("/data/tracking.json"), "/data");

console.log("pathStub.test.ts: all assertions passed");
