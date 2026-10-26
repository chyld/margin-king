import { test } from "node:test";
import assert from "node:assert/strict";
import { lineTokens, parseDoc } from "../../src/shared/syntax.ts";
import { buildRow, chars, fixEquals, newChars, piecesToChanges, serializeRows, setStyle, type Row } from "../../src/shared/model.ts";

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
  "=={font-inter}fonts== =={lime+font-fira-code}`x` y== =={font-a+u}order==",
  "```python font-fira-code\n=={font-x}literal==\n```",
];

test("an unchanged model serializes to exactly the original text", () => {
  for (const s of SAMPLES) assert.equal(roundTrip(s), s, s);
});

test("random lines round trip", () => {
  const alphabet = ["a", "b", " ", "=", "==", "=={b}", "=={green}", "=={u+lime}", "=={font-x}", "=={lime+font-a-b}", "`", "[", "]", "(", ")", "https://x.co", "[t](https://y.co)", "{", "}", "+", "\n```font-x\n"];
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
  setStyle(cs[2], { b: true });
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
  for (const row of rows) for (const c of chars(row)) setStyle(c, { b: true });
  const out = serializeRows(rows);
  const changes = piecesToChanges(out.pieces, 0, s.length, (a, b) => s.slice(a, b));
  assert.deepEqual(changes, [
    { from: 0, to: 0, insert: "=={b}" },
    { from: 5, to: 5, insert: "==" },
    { from: 6, to: 6, insert: "=={b}" },
    { from: 11, to: 11, insert: "==" },
  ]);
});

test("fonts: a run with only a font is written as a highlight (architecture §15, Fonts)", () => {
  const write = (text: string, rows: Row[]) => serializeRows(rows).toString((a, b) => text.slice(a, b));
  const rows = rowsOf("plain");
  for (const c of chars(rows[0])) setStyle(c, { font: "inter" });
  assert.equal(write("plain", rows), "=={font-inter}plain==");
  // Restyling keeps the font, and changing only the font rewrites the marker.
  const two = rowsOf("=={u+font-a}x==");
  setStyle(chars(two[0])[0], { b: true });
  assert.equal(write("=={u+font-a}x==", two), "=={b+u+font-a}x==");
  const three = rowsOf("=={font-a}x==");
  setStyle(chars(three[0])[0], { font: "b" });
  assert.equal(write("=={font-a}x==", three), "=={font-b}x==");
});

test("fonts: an = that must leave a highlight loses its font too", () => {
  const rows = rowsOf("sum=");
  for (const c of chars(rows[0])) setStyle(c, { font: "inter" });
  assert.equal(fixEquals(rows[0]), true);
  assert.equal(serializeRows(rows).toString((a, b) => "sum=".slice(a, b)), "=={font-inter}sum==" + "=");
});
