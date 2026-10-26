import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { analysisField, collapsedField, expandSections } from "../../src/client/editor/fields.ts";

function state(doc: string, collapsed: string[]) {
  return EditorState.create({ doc, extensions: [analysisField, collapsedField.init(() => new Set(collapsed))] });
}

test("editing a collapsed heading's text keeps it collapsed under the new text", () => {
  const s = state("## {red} Alpha\nbody", ["## {red} Alpha"]);
  const next = s.update({ changes: { from: 14, insert: "!" } }).state;
  assert.deepEqual([...next.field(collapsedField)], ["## {red} Alpha!"]);
});

test("deleting a collapsed heading doesn't collapse the next one (code review r1)", () => {
  const doc = "## {red} Alpha\nbody\n## {blue} Beta\nmore";
  const s = state(doc, ["## {red} Alpha"]);
  const next = s.update({ changes: { from: 0, to: doc.indexOf("## {blue}") } }).state;
  assert.ok(!next.field(collapsedField).has("## {blue} Beta"));
});

test("an expansion in the same transaction as a rename uses the old text (code review r1)", () => {
  const s = state("## {red} Alpha\nbody", ["## {red} Alpha"]);
  const next = s.update({ changes: { from: 14, insert: "X" }, effects: expandSections.of(["## {red} Alpha"]) }).state;
  assert.equal(next.field(collapsedField).size, 0);
});
