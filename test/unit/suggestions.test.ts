import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestions } from "../../src/client/ui/menubar.ts";

test("tag suggestions: prefix first, then count, then name; at most 8 rows with Add new tag", () => {
  const all = Array.from({ length: 10 }, (_, i) => ({ tag: `tag${i}`, count: i }));
  const rows = suggestions(all, [], "tag");
  assert.equal(rows.length, 8);
  assert.equal(rows[7].isNew, true);
  assert.deepEqual(rows.slice(0, 3).map((r) => r.tag), ["tag9", "tag8", "tag7"]);
  assert.deepEqual(suggestions([{ tag: "beta", count: 1 }, { tag: "alpha", count: 1 }, { tag: "xalp", count: 9 }], ["beta"], "alp").map((r) => r.tag), ["alpha", "xalp", "alp"]);
});
