// A fixed set of households must keep giving the recorded answers. An intended change (a fix,
// a new rules pack) is re-recorded with `node scripts/regression.mjs --update` and reviewed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { households, keyOutputs, packFor } from "./regression/households.mjs";

const recorded = JSON.parse(readFileSync(new URL("./fixtures/regression.json", import.meta.url)));
const pack = packFor();

test("representative households give the recorded results", () => {
  assert.equal(`${pack.packId}@${pack.packVersion}`, recorded.rulesPack, "recorded with a different rules pack; re-record and review");
  for (const { name, user } of households())
    assert.deepEqual(keyOutputs(user, pack), recorded.households[name], `${name} changed; run node scripts/regression.mjs to see the diff`);
});
