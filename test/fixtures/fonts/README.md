# Font fixtures

Fonts for the browser tests (architecture §15, Fonts), laid out like an admin's `fonts/` folder:
Liberation Mono (Regular and Bold, as WOFF2) in `monospace/`; in `other/`, Liberation Sans (Regular,
and an Italic that the scan skips, as TTF) in a folder of its own, and Liberation Serif (Regular, as
WOFF).

They're the Liberation 2 fonts cut down to printable ASCII with fontTools' `pyftsubset`, under the
SIL Open Font License 1.1 ([`LICENSE-Liberation.txt`](LICENSE-Liberation.txt)).
