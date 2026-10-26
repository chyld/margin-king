# Font fixtures

Fonts for the browser tests (architecture §15, Fonts), laid out like an admin's `fonts/` folder.
In `monospace/`: Fira Code (Regular, as WOFF2, with its ligatures) and Liberation Mono (Regular and
Bold, as WOFF2). In `other/`: Liberation Sans (Regular, and an Italic that the scan skips, as TTF)
in a folder of its own, and Liberation Serif (Regular, as WOFF).

They're the Liberation 2 fonts and Fira Code 6.2 cut down to printable ASCII with fontTools'
`pyftsubset` (Fira Code keeping its `calt` and `liga` features), under the SIL Open Font License 1.1
([`LICENSE-Liberation.txt`](LICENSE-Liberation.txt), [`LICENSE-FiraCode.txt`](LICENSE-FiraCode.txt)).
