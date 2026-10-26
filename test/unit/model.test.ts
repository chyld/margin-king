import { test } from "node:test";
import assert from "node:assert/strict";
import { lineTokens, parseDoc } from "../../src/shared/syntax.ts";
import { buildRow, chars, newChars, piecesToChanges, serializeRows, setStyle3, type Row } from "../../src/shared/model.ts";

function rowsOf(text: string): Row[] {
  return parseDoc(text).lines.map((l) => buildRow(l, lineTokens(l)));
}

function roundTrip(text: string): string {
  const out = serializeRows(rowsOf(text));
  return out.toString((a, b) => text.slice(a, b));
}

const SAMPLES = [
  "plain text",
  "=={green}wrist exercises== and =={amber-deep}yells==",
  "=={u+lime}keeps order== =={b+green}too==",
  "=={b}a`x`b== then `code` and [the docs](https://example.com/docs) https://a.com/x.",
  "=={g}not valid== =={b}[x](https://a.com/?a==b)==",
  "`a``b` ``empty `` ` stray",
  "=={green}=={b}abc==",
  "=={green}https://x.com?q=a==b==",
  "## {green-deep} Notes =={b}App==",
  "```js\n=={red}literal==\n```",
  "![](a7p2xq9d.png)",
  "",
  "emoji 👩‍💻 =={b}👍==",
  "=={red}a===",
  "=={b}x== =={b}y==",
];

test("an unchanged model serializes to exactly the original text", () => {
  for (const s of SAMPLES) assert.equal(roundTrip(s), s, s);
});

test("random lines round trip", () => {
  const alphabet = ["a", "b", " ", "=", "==", "=={b}", "=={green}", "=={u+lime}", "`", "[", "]", "(", ")", "https://x.co", "[t](https://y.co)", "{", "}", "+"];
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) % 1000) / 1000;
  for (let n = 0; n < 3000; n++) {
    let s = "";
    const len = 1 + Math.floor(rnd() * 12);
    for (let i = 0; i < len; i++) s += alphabet[Math.floor(rnd() * alphabet.length)];
    assert.equal(roundTrip(s), s, JSON.stringify(s));
  }
});

test("unchanged rows produce no changes", () => {
  for (const s of SAMPLES) {
    const out = serializeRows(rowsOf(s));
    assert.deepEqual(piecesToChanges(out.pieces, 0, s.length, (a, b) => s.slice(a, b)), [], s);
  }
});

test("restyling writes canonical options; untouched tokens keep theirs", () => {
  const s = "=={u+lime}a== b";
  const rows = rowsOf(s);
  const cs = chars(rows[0]);
  setStyle3(cs[2], { color: null, b: true, u: false });
  assert.equal(roundTrip(s), s);
  assert.equal(serializeRows(rows).toString((a, b) => s.slice(a, b)), "=={u+lime}a== =={b}b==");
});

test("text typed into a token keeps its marker bytes", () => {
  const s = "=={u+lime}abc==";
  const rows = rowsOf(s);
  const last = chars(rows[0])[2];
  rows[0].items.push(...newChars("d", last));
  assert.equal(serializeRows(rows).toString((a, b) => s.slice(a, b)), "=={u+lime}abcd==");
});

test("changes keep retained characters in place", () => {
  const s = "alpha\nbravo";
  const rows = rowsOf(s);
  for (const row of rows) for (const c of chars(row)) setStyle3(c, { color: null, b: true, u: false });
  const out = serializeRows(rows);
  const changes = piecesToChanges(out.pieces, 0, s.length, (a, b) => s.slice(a, b));
  assert.deepEqual(changes, [
    { from: 0, to: 0, insert: "=={b}" },
    { from: 5, to: 5, insert: "==" },
    { from: 6, to: 6, insert: "=={b}" },
    { from: 11, to: 11, insert: "==" },
  ]);
});
