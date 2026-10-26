# Margin

Margin is a small, self-hosted note-taking app for a handful of people (fewer than five). Notes are
plain text with a light formatting syntax: 24 highlight colors, bold, underline, code, links,
collapsible colored sections and pasted screenshots. You can view a note **rendered** or **raw**, and
edit it in either. There's no database: every note is a folder of files on disk. It runs in Docker on
port 5555.

This README is the full specification of the app as built: what it does, how it looks and how it
works inside. It's detailed enough to rebuild Margin from scratch.

![Margin: a note in render mode](docs/screenshots/desktop-render.png)

## Contents

1. [Screenshots](#1-screenshots)
2. [Running Margin](#2-running-margin)
3. [Features](#3-features)
4. [Design](#4-design)
5. [Architecture](#5-architecture)
6. [Decisions](#6-decisions)
7. [Known limitations](#7-known-limitations)

---

## 1. Screenshots

**Render mode** (above): highlights, bold and underline, a link, inline code, three colored
sections with their bars, a code block, a pasted screenshot and the end-of-file marker. The sidebar
lists notes as cards colored by their first tag.

| Raw mode | Proportional font |
|---|---|
| ![Raw mode](docs/screenshots/desktop-raw.png) | ![Proportional font in render mode](docs/screenshots/desktop-proportional.png) |
| The same note with all syntax visible. | Render mode with the proportional font; code stays monospace. |

| Formatting popup (on a selection) | Formatting bar (palette button) |
|---|---|
| ![Selection popup](docs/screenshots/format-popup.png) | ![Pinned formatting bar](docs/screenshots/format-bar.png) |
| Appears under selected text. The swatch of the current color is ringed. | Opens under the palette button and stays open while you edit. |

| Tag suggestions | Collapsed section and search |
|---|---|
| ![Tag suggestions](docs/screenshots/tag-suggestions.png) | ![Collapsed section and search](docs/screenshots/collapsed-and-search.png) |
| Typing in the tag box suggests your existing tags. | "Metrics" is collapsed (⋯). The search box filters the list to "Lisbon trip". |

| Trash | Empty state |
|---|---|
| ![Trash view](docs/screenshots/trash.png) | ![Empty state](docs/screenshots/empty-state.png) |
| The trash list and a trashed note, read-only, with Restore and Delete forever. | No note open (the home page). |

| Log in | Not found |
|---|---|
| ![Login page](docs/screenshots/login.png) | ![404 page](docs/screenshots/not-found.png) |

**Phone** (iPhone 12 Pro size):

| Note list (drawer) | Note | Formatting (docked) |
|---|---|---|
| <img src="docs/screenshots/mobile-list.png" width="250" alt="Note list on a phone"> | <img src="docs/screenshots/mobile-note.png" width="250" alt="Note on a phone"> | <img src="docs/screenshots/mobile-format.png" width="250" alt="Formatting popup on a phone"> |

---

## 2. Running Margin

### Install

You need Docker with Docker Compose.

```sh
git clone https://github.com/chyld/note-mvp.git margin
cd margin
docker compose up -d --build
```

Margin now listens on port **5555** on all network interfaces: open `http://<host>:5555`.

### Users

Users are created on the command line; you're asked for a password (at least 4 characters):

```sh
docker compose exec margin margin-user add alice
docker compose exec margin margin-user list
docker compose exec margin margin-user passwd alice
docker compose exec margin margin-user remove alice   # their notes stay on disk
```

Usernames are 1–32 characters of `a-z`, `0-9`, `_` and `-`. For scripts, set `MARGIN_PASSWORD`
instead of typing the password. Changes take effect immediately, with no restart. Removing a user
also ends their sessions.

### Update

```sh
git pull
docker compose up -d --build
```

### Data and backups

Everything lives in `./data` next to `compose.yaml` (layout in [5.3](#53-data-on-disk)). To back up
Margin, copy that folder. The container runs as UID/GID 1000 so the files belong to your user; if
your IDs differ:

```sh
MARGIN_UID=$(id -u) MARGIN_GID=$(id -g) docker compose up -d
```

### Security

Margin uses **plain HTTP**: passwords and the session cookie travel unencrypted. That's fine on a
trusted home network, not on the open internet. To reach Margin from outside, put it behind a
reverse proxy with TLS (Caddy, nginx) or use a VPN such as Tailscale.

### Development

```sh
npm install
npm run watch                              # rebuild the client bundle on change
DATA_DIR=./dev-data PORT=5556 npm start    # in another terminal
MARGIN_PASSWORD=secret DATA_DIR=./dev-data node cli.js add dev
```

There are no automated tests yet; the MVP was verified by hand in a browser.

---

## 3. Features

### 3.1 Notes

- A note is plain text. Its **title is its first line**, with formatting syntax removed (and the
  `## {color} ` part if the first line is a section heading). An empty first line shows as a grey,
  italic **Untitled** in the list.
- **+ New note** creates an empty note immediately on the server, opens it and puts the cursor in
  it. If the list is filtered by a tag, the new note gets that tag. Empty notes are fine.
- Each user's notes are **private**: users never see each other's notes, tags or links.
- Note ids are 8 characters of `a-z0-9`, random.

### 3.2 Saving

- Notes save **only on demand**: the save button or **Ctrl+S** (Cmd+S). There's no autosave.
- The save button is an icon whose color shows the state:

  | State | Look | Tooltip |
  |---|---|---|
  | Saved | green floppy on pale green | Saved (Ctrl+S) |
  | Unsaved changes | white floppy on orange, pink dot in the corner | Unsaved changes · click to save |
  | Saving | white on blue, pulsing | Saving… |
  | Failed | white on red, with the dot | Save failed · click to retry |

- "Unsaved" means the editor text differs from the last saved text, so undoing back to the saved
  text makes the note clean again.
- The browser asks before leaving the page with unsaved changes. Inside the app, switching notes,
  creating a note, going home or logging out with unsaved changes asks
  "You have unsaved changes. Discard them?".
- **Two tabs on the same note:** the last save wins. There's no conflict detection.
- Saving updates the note's **last modified** time, which orders the note list.

### 3.3 Render and raw modes

- **Render mode** hides the syntax and shows the formatting: colors, bold, underline, code, links,
  sections, screenshots, and the title in a large font. You can **edit directly in render mode**.
- **Raw mode** is a plain-text editor showing every character of syntax. It's always monospace.
- A sliding toggle in the menu bar switches modes: an eye icon for render, a code icon for raw. The
  thumb is violet on render and teal on raw. **Ctrl+E** also switches. The choice is remembered per
  browser.

### 3.4 Fonts

- Render mode can use a **monospace** or a **proportional** font, chosen with a second sliding
  toggle showing "Aa" in each font (orange thumb for monospace, green for proportional).
- In the proportional font, inline code and code blocks stay monospace.
- Raw mode always uses monospace; the font toggle is dimmed there, with the tooltip "Raw mode always
  uses the monospace font".
- The choice is remembered per browser.

### 3.5 Formatting syntax

Margin only recognizes the syntax below. Nothing else (markdown lists, `*italics*`, `#` headings,
tables) is interpreted; it stays plain text. There is **no escape character**: text only becomes
formatting if it exactly matches a valid pattern, so a stray `==` or an unknown color stays literal.

| Write | Shows as |
|---|---|
| `=={green}wrist exercises==` | light green highlight |
| `=={amber-deep}computer that yells at you==` | deep amber highlight |
| `=={b}together==` | bold |
| `=={u}duplicates==` | underlined |
| `=={lime+b+u}yearbook==` | light lime, bold and underlined |
| `` `inline code` `` | inline code |
| `https://example.com` | a link |
| `[the docs](https://example.com/docs)` | a link showing "the docs" |
| `## {green-deep} Notes App` | a collapsible section heading |
| ```` ``` ```` on its own line, code, ```` ``` ```` | a code block |
| `![](a7p2xq9d.png)` | a pasted screenshot |

**Highlights** `=={options}text==`

- Options are joined with `+`: at most one color, plus `b` (bold) and/or `u` (underline), each at
  most once, in any order. When Margin writes them, the order is color, then `b`, then `u`.
- The text must be non-empty and on one line. It ends at the first `==` that isn't inside inline
  code or a link.
- Inline code, links and bare URLs can sit inside a highlight. Highlights don't nest.
- The **24 colors** are 12 hues, each light (`<hue>`) and deep (`<hue>-deep`):

  | Hue | Light | Deep |
  |---|---|---|
  | `red` | `#ffd2cc` | `#ff9b93` |
  | `orange` | `#ffd7b8` | `#ffa46e` |
  | `amber` | `#ffdfac` | `#ebb353` |
  | `lime` | `#d9eeb7` | `#aacc6b` |
  | `green` | `#c2f3cb` | `#7cd590` |
  | `mint` | `#b2f5dd` | `#53d8b1` |
  | `teal` | `#a8f5f4` | `#2ad7d7` |
  | `sky` | `#b0efff` | `#4fcdff` |
  | `blue` | `#c9e6ff` | `#8fbdff` |
  | `violet` | `#e7dbff` | `#c4acff` |
  | `fuchsia` | `#ffd3fe` | `#eb9fe8` |
  | `pink` | `#ffd0e7` | `#ff99c2` |

**Inline code** `` `code` ``

- Single backticks around non-empty text on one line. Everything inside is literal: no highlights,
  links or URLs.

**Links**

- **Bare URLs**: `http://` or `https://` followed by anything except whitespace, `<>()[]` and
  backticks. The URL must not directly follow a letter, digit or `/`. Trailing `. , ; : ! ? ' " * _ ~ =`
  aren't part of it.
- **Link text**: `[text](url)`, where the text is non-empty, on one line and contains no `]`, and the
  url is an `http(s)://` URL as above. Link text is plain (no formatting inside the brackets), but
  a whole link can sit inside a highlight.
- URLs inside code are never links.

**Sections** `## {color} Heading`

- Exactly `## `, a color name from the 24 in braces, a space, then heading text that starts with a
  non-space character. Anything else is a plain line.
- A section runs from its heading to the line before the next section heading, or the end of the
  note.

**Code blocks**

- An opening line that starts with ```` ``` ```` (anything after it, such as a language name, is
  ignored), and a closing line that is exactly ```` ``` ```` (trailing spaces allowed).
- A block needs its closing fence; an unclosed ```` ``` ```` is plain text.
- Everything inside is literal. Lines inside a block are never headings or screenshots.

**Screenshots** `![](name.png)`

- Only when it's the whole line, and the name is 8 characters of `a-z0-9` plus `.png`.

### 3.6 Formatting popup and formatting bar

Selecting text shows the **formatting popup** under the selection (above it if there's no room
below). The **palette button** in the menu bar opens the same options as a **formatting bar** under
the button that stays open while you edit.

![Formatting popup](docs/screenshots/format-popup.png)

Layout:

```
[ B ][ U ][ </> ][ Section ][      Clear formatting      ]
[ 🔗 Link ][              Remove color                   ]
  a  a  a  a  a  a  a  a  a  a  a  a      ← 12 light colors
  a  a  a  a  a  a  a  a  a  a  a  a      ← 12 deep colors
            Enter applies · Esc closes
```

Each swatch is the color with a sample "a" on it. Buttons that are "on" for the selection are filled
violet (B, U, </>, Section, Link). The swatch of the selection's color is ringed.

What each option does to the selection:

| Option | Effect |
|---|---|
| **B** / **U** | Toggle bold / underline. If every selected character already has it, it's removed; otherwise it's added to all. |
| **</>** | Within one line: toggle inline code on the selected characters. Across lines: wrap the lines in a code block (their inline formatting is dropped, since code is literal), or, if the selection touches a code block, remove that block's fences. |
| **Section** | Turns the selected line (the first non-empty one) into `## {blue-deep} …`, or turns a heading back into a plain line. |
| **Clear formatting** | Removes color, bold, underline and inline code (links stay). |
| **Link** | Asks for an address in a prompt (`example.org` becomes `https://example.org`). On an existing link the prompt shows its address; edit it, or leave it empty to remove the link. An invalid address shows "That isn't a web address". |
| **Remove color** | Removes the highlight color, keeping bold and underline. |
| **A swatch** | Sets that color. If everything selected already has that color, it's removed. |

Rules:

- Formatting works per line; a selection across several lines formats each line.
- After applying, the same visible text stays selected, so you can apply several options in a row.
- **Section headings take their color from the section.** Picking a color while text in a heading is
  selected **recolors the section** (`## {color}`, which also recolors its bar) instead of
  highlighting the text, and removes any highlight colors inside the heading. Highlight colors
  inside a heading are never shown; bold and underline are.
- Inside a code block only </> works (it removes the block); the other options are dimmed.
- **Keyboard**: the arrow keys move a pink focus ring over the options (rows: the first button row,
  Link and Remove color, the light swatches, the deep swatches), **Enter** applies the focused option,
  **Esc** closes the popup. Esc hides it for that selection; changing the selection brings it back.
- The popup doesn't appear while the mouse button is held (it waits for mouseup), when the editor
  isn't focused, or when the note is read-only (trashed).
- Clicking popup buttons doesn't move focus out of the editor or change the selection.

The **formatting bar** (palette button):

- Toggles open and closed under the palette button, which shows as pressed while open.
- Stays open while you type and click in the note. It closes with Esc, the palette button again, a
  click outside the note and bar, switching notes, or switching modes.
- With **nothing selected**, an option applies to the **word at the cursor**, and the cursor goes
  back to the end of that word. Section applies to the cursor's line. With no word at the cursor,
  the hint line shows "Select some text first".
- With nothing selected, the arrow keys and Enter keep working in the note as usual.

On phones and touch screens both are **docked** at the bottom of the screen instead (see
[3.19](#319-phones-and-touch-screens)).

### 3.7 Editing in render mode

The note is always stored as raw text; render mode hides the syntax. Editing is adjusted so you
can't accidentally break hidden syntax:

- **The cursor skips hidden syntax**: the hidden parts of highlights, code, links, heading prefixes,
  screenshots, collapsed sections and hidden code fences behave as single units.
- **Typing at the end of a highlighted word extends the highlight.** Press → once more to step out.
  The boundary isn't visible.
- **Backspace**
  - right after a highlight, code or link deletes its last visible character, not the hidden syntax;
  - deleting a token's only remaining character removes the whole token (and an enclosing highlight
    left empty);
  - at the start of a heading's text, turns the heading back into a plain line;
  - deleting the last character of a heading's text removes the heading line's content;
  - right after a screenshot, deletes the screenshot's line;
  - at the start of a line, joins it to the previous line only if that keeps both intact: always if
    either line is empty; never if either is a code fence or screenshot, if the line is a heading, or
    if only one of them is inside a code block. Otherwise the cursor just moves to the end of the
    previous line.
- **Delete** mirrors Backspace forward.
- **Enter**
  - inside a highlight, code or link, closes it before the line break and reopens it after, so both
    halves keep their formatting (`=={green}wri==` / `=={green}st==`). At a token's edge, it steps
    outside instead of leaving an empty piece;
  - at the start of a heading's text, inserts the line break before the heading.
- **Selecting across syntax and typing or deleting** never cuts a token in half: changes that cover
  only part of a token leave its hidden syntax in place. Highlights, inline code and links left empty
  by a deletion are removed.
- **Tab / Shift+Tab** inside a code block indent / outdent the line (or selected lines) by two
  spaces, in both modes. Elsewhere Tab moves focus as usual.
- Undo/redo (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y) cover everything, including formatting. Each note has
  its own history, reset when you open it.
- Copying copies the raw text, so pasting into another note keeps the formatting.

### 3.8 Sections

![A collapsed section](docs/screenshots/collapsed-and-search.png)

In render mode:

- The `## {color} ` prefix is replaced by a **⌄ toggle**. The heading text is larger (1.3×), bold,
  and drawn in a **dark shade of the section's color** (see [4.4](#44-derived-colors)).
- A **4px vertical bar in the section's color** runs down the left of the section's content (not the
  heading). Code blocks inside a section sit indented to the right of the bar.
- Clicking ⌄ **collapses** the section: the toggle rotates to point right, the content disappears,
  and a small **⋯** pill in a pale version of the color appears after the heading. Clicking the
  toggle or the pill expands it again.
- Collapsed sections are **remembered per browser**, per note, by the heading line's exact text.
  Collapsing never counts as an unsaved change. Raw mode always shows everything.

### 3.9 Code blocks

- Rendered as a grey panel (`#f6f5fb`) with a 1px border and rounded corners, in monospace, with no
  syntax highlighting.
- The ```` ``` ```` fence lines shrink to thin panel edges with their text hidden, **unless the cursor is
  on them**, when they show in light grey so you can edit them.
- Hovering a block shows a violet **Copy** button in its top-right corner. It copies the code
  without the fences and says "Copied" for a moment. On touch screens it's always visible. Copying
  works over plain HTTP: it falls back to a hidden textarea when the Clipboard API isn't available.

### 3.10 Links

- Links are violet (`#4b3fe0`) with a soft underline. Hovering shows the URL and
  "Ctrl+click to open" ("Cmd+click to open" on a Mac).
- A **plain click puts the cursor in the link**, so links can be edited like any text.
  **Ctrl+click** (Cmd+click) opens the link in a new tab, in render or raw mode. While Ctrl/Cmd is
  held, links show a pointer cursor and a solid underline.
- **Pasting a URL while text is selected** (within one line) turns the text into a link to it.
- Applying other formatting on the same line keeps links intact. Enter inside a link splits it into
  two links to the same address. Deleting all of a link's text removes the link.
- Search matches a link's visible text, not its URL.

### 3.11 Screenshots

- **Paste** an image into a note to upload it. Only **PNG** is accepted; anything else shows
  "Only PNG screenshots are allowed". There's no size limit.
- While uploading, a toast says "Uploading screenshot…". The image is stored in the note's folder
  under a random 8-character name, and `![](name.png)` is inserted **on its own line** at the cursor
  (line breaks are added before and after as needed).
- In render mode the line shows the image (rounded corners, soft shadow, full width at most). A
  missing file shows "Missing screenshot" in italics.
- Uploaded images are **kept even if their line is deleted** from the note. They're only deleted
  with the note (Delete forever or Empty trash).

### 3.12 End-of-file marker

Every note ends with a marker below the last line, in both modes: a thin grey line (`#c9cacb`) across
the full width, ending in a small diamond at each end, broken in the middle by three dots in a
triangle (`#8c9099`, one dot on top, two below).

### 3.13 Tags

![Tag suggestions](docs/screenshots/tag-suggestions.png)

- Tags sit in the menu bar above the note, as colored chips with an × to remove them.
- Tags are **lowercase `a-z` and `0-9` only**. The tag box lowercases what you type and drops other
  characters as you type. **Enter**, **space** or **comma** adds the tag; clicking away adds what's
  typed; **Backspace** in the empty box removes the last tag; **Esc** clears the box and returns to
  the note. Maximum length 40.
- Tags **save immediately**, separately from the note text. Changing tags **doesn't save unsaved
  text and doesn't change the note's last-modified time** or its place in the list.
- **Suggestions**: focusing the tag box lists your existing tags. These are the tags your notes use
  right now (trashed notes don't count), with how many notes use each, excluding tags already on this
  note. Typing filters them: tags starting with what you typed come first, then by count, then
  alphabetically, at most 8. If what you typed isn't an existing tag, the last entry is
  **Add new tag <text>**.
  - With text typed, the first entry is highlighted and **Enter** takes it, so `alp` + Enter adds
    `alpha`, not `alp`.
  - The arrow keys move the highlight; clicking an entry adds it; Esc on an empty box closes the
    list.
- A tag no note uses any more disappears from suggestions and the filter automatically (the filter
  keeps it, with a count of 0, only while it's the selected filter).
- **Filter**: the dropdown at the top of the sidebar lists **All notes** and each tag with its count.
  Picking one filters the note list (and, when no note is open, changes the address to `?tag=…`).
- **Colors**: every tag has its own color, derived from its name ([4.4](#44-derived-colors)), used for
  its chips everywhere and for the stripe on note cards.

### 3.14 Search

- The search box in the sidebar searches the **text** of your notes: what render mode shows, so
  syntax like `=={green}` isn't searchable but code is.
- Case-insensitive. The query is split on spaces and a note matches if it contains **every** word,
  anywhere, even inside other words (`exer` finds "exercises").
- Combined with the tag filter. In the trash view it searches trashed notes.
- Runs 200ms after you stop typing. Results are ordered like the normal list. There's no ranking
  and no highlighting of matches.

### 3.15 Sidebar and note list

- From top to bottom:
  - the **Margin** logo, which goes home;
  - a button to hide the sidebar;
  - **+ New note**;
  - the **tag filter**;
  - the **search** box;
  - the **note list**;
  - at the bottom, **Trash**, your avatar and username, and **Log out**.
- Notes are listed **newest-modified first** (trash: newest-trashed first). Each card shows:
  - the title;
  - the last-modified date and time (e.g. "Oct 25, 2026, 6:25 PM", in the browser's locale);
  - the tags as small colored chips;
  - a colored stripe on the left from its first tag.
- The open note's card is white, with a ring in its tag color.
- Empty lists say "No notes yet", "No matching notes" or "Trash is empty".
- **Hiding the sidebar** (desktop) is remembered per browser; a button in the menu bar brings it
  back.
- **Clicking the logo** goes **home**: closes the note (asking first about unsaved changes), clears
  the tag filter, search and trash view, and sets the address to `/`. Ctrl/middle-click opens home
  in a new tab.
- The **empty state** (home) says "Pick a note, or start a fresh one" with a New note button, over
  three slowly drifting blurred color blobs.

### 3.16 Trash

![Trash](docs/screenshots/trash.png)

- The **trash can** button in the menu bar moves the open note to the trash after a confirmation:
  `Move "<title>" to the trash?`, plus "Your unsaved changes will be lost." if there are any. A toast
  says "Moved to trash".
- **Trash** at the bottom of the sidebar switches the list to trashed notes (the button becomes
  **← Back to notes**). A red-tinted header shows **Empty trash**, and the tag filter is disabled.
- A trashed note opens **read-only** under a banner: "This note is in the trash." with **Restore**
  and **Delete forever**. Save, formatting, trash and the tag box are hidden.
- **Restore** puts the note back, returns to the normal list and reopens it editable ("Restored").
- **Delete forever** (confirmed) deletes the note's folder, screenshots included.
- **Empty trash** (confirmed, with the count) deletes all trashed notes.
- Nothing is deleted automatically; the trash is only emptied by hand.

### 3.17 Addresses, links and navigation

- The address bar always reflects what you're looking at: `/?note=<id>` when a note is open,
  otherwise `/?tag=<tag>` when filtering, otherwise `/`. A link is to a note **or** a tag, never
  both.
- Moving around **replaces** the history entry rather than adding one, so Back and Forward don't
  step through notes (Back leaves the app).
- Opening a link:
  - logged out → the login page, at the same address, so after logging in you land on the link;
  - a note that doesn't exist (for you) or a tag no note of yours uses → **404** page ("That note or
    tag doesn't exist.");
  - both `note` and `tag`, or any other parameter → 404;
  - a trashed note opens read-only with the trash banner.
- `?tag=work` opens with the filter set and no note open.

### 3.18 Users and sessions

- Fewer than five users, created with the CLI ([2](#users)). There's no sign-up page.
- The login page asks for username and password. A wrong password shows "Wrong username or password"
  after a half-second delay.
- Logins last **30 days** and renew while you use Margin (sliding expiry). **Log out** (icon at the
  bottom of the sidebar, asking about unsaved changes first) ends the session.
- If a session ends while a note is open with unsaved changes, Margin shows an error instead of
  reloading, so you can copy your text first.

### 3.19 Phones and touch screens

<img src="docs/screenshots/mobile-list.png" width="200" alt="Note list"> <img src="docs/screenshots/mobile-note.png" width="200" alt="Note"> <img src="docs/screenshots/mobile-format.png" width="200" alt="Formatting">

Screens **760px wide or less**:

- The sidebar becomes a **drawer** that slides over the note from the left (86% of the width, at
  most 330px), over a dimmed backdrop.
  - **☰** in the menu bar opens it.
  - **✕**, tapping the backdrop or opening a note closes it.
  - It opens by itself when no note is open (on first load, after going home or trashing a note).
- The menu bar puts the tools and trash on the first row and the **tags on their own row**.
- Smaller margins and title; **16px** text and inputs (which stops iPhones zooming in when an input is
  focused).
- The layout uses the dynamic viewport height (address bars showing and hiding) and keeps clear of
  notches and the home bar (safe-area insets).

Phones and **touch screens** (any size):

- The formatting popup and bar **dock at the bottom of the screen** instead of next to the
  selection, clear of the system's selection handles and copy/paste menu, and move up **above the
  on-screen keyboard**. On phones they're compact (12 swatches per row, no keyboard hint).
- There's no Ctrl+click, so putting the cursor in a link shows a small dark **chip** above it with
  the link's address; tapping it opens the link.
- Code blocks always show their Copy button.

### 3.20 Keyboard shortcuts

| Keys | Action |
|---|---|
| Ctrl/Cmd+S | Save |
| Ctrl/Cmd+E | Switch render / raw |
| Ctrl/Cmd+click a link | Open it in a new tab |
| Arrows, Enter, Esc | Navigate, apply, close the formatting popup |
| Tab / Shift+Tab in a code block | Indent / outdent by two spaces |
| Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y | Undo / redo |
| Enter, space, comma (tag box) | Add the tag |
| Backspace in an empty tag box | Remove the last tag |

### 3.21 Messages and confirmations

- Confirmations use the browser's built-in dialogs: discarding unsaved changes, moving to the trash,
  Delete forever, Empty trash, and the Link prompt.
- Short messages appear as **toasts** at the bottom center for 2.5s (errors in red, for 5s): "Moved
  to trash", "Restored", "Uploading screenshot…", "Only PNG screenshots are allowed", save and
  network errors.

---

## 4. Design

### 4.1 Principles

- **Colorful, bright and light.** Pastel washes, colored chips and cards, solid-color controls.
  Color carries meaning: tags have colors, sections have colors, states have colors.
- **No rainbows and no gradient buttons.** Buttons, toggles and states are solid colors. The only
  gradients are soft background washes, the avatar, the trash tints and the logo icon.
- **Notes look like paper**: a white card with rounded corners and a soft shadow, floating on a pale
  lavender background. Notes default to a **monospace** font.
- **Icon-first toolbar**: save, mode, font, formatting and trash are icons with tooltips.

### 4.2 Color tokens

| Token | Value | Use |
|---|---|---|
| `--bg` | `#f6f4fd` | page background (pale lavender) |
| `--ink` | `#1f1b2e` | text, toasts |
| `--muted` | `#7b7591` | secondary text, inactive icons |
| `--line` | `#e7e2f4` | borders |
| `--violet` | `#7c5cff` | primary color: New note, active buttons, cursor, focus, Copy |
| `--violet-dark` | `#6a48f0` | primary hover |
| `--red` | `#e5484d` | danger, errors |
| `--code-bg` / `--code-border` | `#f6f5fb` / `#e2ddf0` | inline code and code blocks |
| link | `#4b3fe0` | links (underline at 35% opacity) |
| inline code text | `#5b3fd6` | |
| selection | `#e6deff` | text selection |
| shadows | `rgb(60 40 140 / …)` | violet-tinted: sm `0 1px 2px /.06, 0 2px 8px /.05`; md `0 4px 14px /.10`; lg `0 18px 50px /.18, 0 2px 6px /.08` |

Control colors:

| Control | Color |
|---|---|
| Save: saved / unsaved / saving / failed | `#1d9a59` on `#e6f8ee` / white on `#ff7a45` (+ dot `#ff3d71`) / white on `#4f8bff` / white on `#e5484d` |
| Render/raw thumb | `#7c5cff` (render) / `#1fb5a8` (raw) |
| Font thumb | `#ff7a45` (monospace) / `#2fb874` (proportional) |
| Keyboard focus ring in the popup | `#ff5fa2` |

Backgrounds:

- **Sidebar**: a vertical wash from `#fbf5ff` through `#f3f5ff` to `#edfaf7`.
- **Behind the editor**: faint radial glows, pink at the top right, sky at the bottom left, amber at
  the bottom right.
- **Login and 404**: four pastel radial glows (`#ffd3fe`, `#b0efff`, `#ffdfac`, `#c2f3cb`) in the
  corners.

### 4.3 Highlight palette

The 24 note colors are listed in [3.5](#35-formatting-syntax). Highlights are drawn as the color
behind the text with 5px rounded corners and 1px × 3px padding, and keep the note's font.

### 4.4 Derived colors

- **Section heading text** is a dark shade of the section color: take the color's HSL hue, cap its
  saturation at 75%, and set lightness to 28%. For example, `green-deep` gives a dark green and
  `pink-deep` a dark raspberry.
- **Tag and avatar colors** come from the name:

  ```js
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [hue, light, deep] = HUES[h % 12];   // HUES in the order of the palette table
  ```

  A chip uses `light` as background, the dark shade of `deep` as text, and `deep` at 45% as a 1px
  inner ring. Note cards use `deep` for their left stripe and active ring. The avatar is a circle
  with a `light` → `deep` gradient and the user's initial in the dark shade.

### 4.5 Typography

- **UI**: Inter, falling back to the system sans-serif. 14px base; titles and buttons 560–800
  weight.
- **Notes (monospace)**: JetBrains Mono, falling back to Fira Code, ui-monospace, SF Mono, Menlo,
  Consolas. 14px, line height 1.7.
- **Notes (proportional)**: Inter / system sans-serif, 15.5px, line height 1.65. Code stays
  monospace at 13.5px.
- **Title** (first line, render mode): 1.9× size, weight 800.
- **Section headings**: 1.3× size, weight 800.
- No fonts are bundled: these are used if installed.

### 4.6 Layout

Desktop:

- **Sidebar**: 296px wide.
  - **Header**: logo (28px icon, "Margin" in 19px weight 800 violet), and a hide-sidebar button.
  - **New note**: full-width violet button, rounded 12px.
  - **Filter and search**: 36px tall fields, rounded 10px, with icons inside on the left.
  - **Note cards**: 12px side margins, rounded 12px.
  - **Footer**: Trash on the left, avatar + username + log-out icon on the right.
- **Menu bar** (at least 64px tall, 12px × 22px padding):
  - a white "toolgroup" pill (rounded 14px, small shadow) holding save, the render/raw switch, the
    font switch and the palette button;
  - then the tag chips and tag box;
  - a spacer;
  - then the trash button as its own white tile.
- **Tools**: 38px square icons (20px glyph), rounded 10px. **Switches**: 72 × 38px, with a 32px
  thumb that slides 34px.
- **Editor paper**: up to 920px wide, centered, rounded 18px, 44px × 56px padding, soft violet
  shadow.
- **Popup**: 392px wide, rounded 16px, large shadow, 12px padding.

Phone (≤760px): see [3.19](#319-phones-and-touch-screens). Tools 36px, switches 66 × 36px; paper
rounded 14px with 22px × 18px padding; 16px text.

### 4.7 Components

| Component | Look |
|---|---|
| **Buttons** | Rounded 10px. **Primary**: solid violet, white text, violet shadow. **Danger**: red text, pale red border. **Ghost**: no border, muted text, violet on hover. |
| **Note card** | Translucent white; white with a small shadow on hover; when open, white with a 1.5px inner ring in its tag color. Title 650 weight; date 11.5px muted; tags as small chips; 4px stripe on the left in its first tag's deep color (`#d9d3ec` with no tags). |
| **Tag chip** | Pill, 12.5px weight 650, tag-colored; × button that darkens on hover. Small variant (11px) in the note list. |
| **Tag box** | Pill with a dashed lavender border and "+ tag" placeholder; widens and turns solid violet when focused. |
| **Tag suggestions** | White rounded card with a large shadow; rows with a colored dot (with a pale halo) + tag name + a grey count pill; highlighted row pale violet; "Add new tag **name**" with the name in violet. |
| **Save button** | Floppy icon in a 38px tile, colored by state (4.2); the unsaved/failed dot sits in the top-right corner. |
| **Mode / font switches** | Pale lavender track with two glyphs; a colored thumb slides under the active glyph, which turns white. Slight overshoot easing. |
| **Palette button** | A palette outline with four colored paint dots (coral, amber, mint, violet); pressed state pale violet with a violet ring. |
| **Trash button** | Trash-can icon in a white tile; red tint on hover. |
| **Section heading** | ⌄ toggle in the heading color (rotates −90° when collapsed); text in the dark shade; ⋯ pill when collapsed. Content bar 4px at 7px from the left; content indented 22px. |
| **Inline code** | Pale grey-violet background, 1px border, rounded 5px, violet-ish text, 0.92em. Inside a highlight, its background turns translucent white. |
| **Code block** | Panel with a 1px border, rounded 10px, 16px side padding; Copy button: small violet pill. |
| **Link** | Violet text, 1.5px underline at 35% opacity, offset 3px. |
| **Screenshot** | Image rounded 10px with a soft shadow, 6px vertical padding. |
| **Formatting popup** | White, rounded 16px. Buttons 32px tall, rounded 9px, 1px border; active ones solid violet. Swatches rounded 7px with the color and a bold monospace "a"; they grow slightly on hover; the active one has a white gap and a violet ring. |
| **Trash banner** | Warm peach → pink tint, rounded 12px, brown text, coral trash icon, Restore and Delete forever buttons. |
| **Toast** | Dark ink pill at the bottom center with a lavender dot; errors solid red. |
| **Empty state** | Violet heading, muted subtitle, primary button, three blurred blobs (`#ff9ad0`, `#9f8bff`, `#7fe3d0`) drifting on a 14s loop. |
| **Login / 404** | Centered white card (rounded 22px, frosted, large shadow) on the pastel corner glows. Login: logo + "Margin", "Welcome back! Log in to your notes.", username, password, violet Log in button. 404: a big violet "404", "That note or tag doesn't exist.", and a "Go to Margin" button. |
| **Avatar** | 28px circle, tag-style gradient, initial in weight 800. |
| **Favicon / logo** | A rounded square with a violet → magenta → orange gradient, a translucent white margin line, a yellow highlighter bar and two white text lines. |

### 4.8 Icons

Line icons, 1.8px stroke, round caps and joins, `currentColor`, on a 24px grid:

- panel (hide or show the sidebar);
- menu ☰ and close ✕ (phone drawer);
- plus;
- search;
- tag;
- save (floppy);
- trash;
- eye (render) and code `<>` (raw);
- log-out;
- restore (counter-clockwise arrow);
- back arrow;
- link (chain);
- external (box with arrow; link chip);
- palette with colored dots.

They're defined once as SVG `<symbol>`s in `index.html` and used with `<use href="#i-…">`.

---

## 5. Architecture

### 5.1 Overview

- **Server**: Node.js (22+) with Express 5. It serves the pages and a JSON API, and stores
  everything as files. There is no database and no build step on the server.
- **Client**: plain JavaScript modules bundled with esbuild into one file. The editor is
  **CodeMirror 6** (`@codemirror/state`, `@codemirror/view`, `@codemirror/commands`). There is no UI
  framework.
- **The key idea**: the editor's document is always the **raw note text**. Raw mode shows it as is.
  Render mode adds CodeMirror *decorations* that hide the syntax and draw the formatting. Editing
  guards keep hidden syntax intact. Saving sends the raw text, so the file on disk is exactly what
  raw mode shows.
- **Shared parser**: `shared/format.js` parses the note format, and is used by the server (titles,
  search) and the client (rendering, editing, formatting).

### 5.2 Repository layout

```
compose.yaml, Dockerfile       container setup
cli.js                         margin-user command (users)
server/
  server.js                    Express app: pages, API, uploads
  auth.js                      users, password hashing, sessions, cookies
  store.js                     notes on disk: read, list, search, save, trash, images
shared/
  format.js                    the note format: colors, parser, titles, visible text
client/                        bundled into public/build/app.js
  main.js                      app shell: state, sidebar, tags, search, trash, routing, saving
  editor.js                    CodeMirror setup, modes, paste, links, copy button hover
  render.js                    render-mode decorations and widgets, end-of-file marker
  editing.js                   render-mode edit guards and keys; Tab in code
  format-ops.js                formatting engine for the popup
  popup.js                     formatting popup / bar
  colors.js                    dark shade of a color (headings, tags)
public/
  index.html, login.html, 404.html, style.css, favicon.svg
  build/app.js                 (built)
docs/screenshots/              images for this README
data/                          your data (not in git)
```

### 5.3 Data on disk

```
data/
  users.json
  sessions.json
  notes/
    <username>/
      <noteId>/
        note.md          the note's raw text
        meta.json        tags, times, trash state
        <imageId>.png    pasted screenshots
```

`users.json`:

```json
{
  "alice": { "salt": "<32 hex>", "hash": "<128 hex>", "created": "2026-10-25T23:47:53.995Z" }
}
```

`sessions.json` (token → session):

```json
{
  "<64 hex token>": { "user": "alice", "expires": 1764115673995 }
}
```

`meta.json`:

```json
{
  "created": "2026-10-25T23:47:53.995Z",
  "modified": "2026-10-25T23:48:46.746Z",
  "tags": ["work", "alpha"],
  "trashedAt": null
}
```

- **IDs**: note ids and image names are 8 characters of `a-z0-9`, from `crypto.randomBytes` mod 36.
  A new id is re-rolled if it already exists.
- **Writes are atomic**: write to a temporary file, then rename.
- The note list is built by reading every note folder of the user on each request. That's fine for a
  few users with hundreds or a few thousand notes.

### 5.4 Server

**Request handling**

1. Every request looks up the session cookie. A valid session sets `req.user`; if the session was
   renewed, the cookie is re-sent.
2. `GET /favicon.ico` serves the SVG favicon; `public/` is served statically (no index files).
3. `GET /` is the only page route:
   - not logged in → `login.html` (200, same URL);
   - any query parameter other than `note`/`tag`, both together, a `note` that doesn't exist for the
     user, or a `tag` not used by any of the user's non-trashed notes → `404.html` with status 404;
   - otherwise → `index.html`.
4. `/api/login` and `/api/logout` are public. Every other `/api/*` route requires a session (401
   `{ error }` otherwise) and sends `Cache-Control: no-store`.
5. Any other path → `404.html`. Errors → 500 `{ error: "Server error" }` (details are only logged).

**API**

| Method & path | Body | Response |
|---|---|---|
| `POST /api/login` | `{ username, password }` | `{ user }` + session cookie; 401 `{ error: "Wrong username or password" }` after a 500ms delay |
| `POST /api/logout` | | `{ ok: true }`, clears the cookie |
| `GET /api/session` | | `{ user }` |
| `GET /api/notes?tag=&q=&trash=1` | | `[{ id, title, modified, created, tags, trashedAt }]`: non-trashed notes (or trashed with `trash=1`), filtered by tag and search, newest first (by `modified`, or `trashedAt` in the trash) |
| `GET /api/tags` | | `[{ tag, count }]` from non-trashed notes, alphabetical |
| `POST /api/notes` | `{ tags? }` | 201, the new note |
| `GET /api/notes/:id` | | `{ id, text, created, modified, tags, trashedAt }` |
| `PUT /api/notes/:id` | `{ text }` (up to 50MB) | the new meta; sets `modified`; 409 if trashed |
| `PUT /api/notes/:id/tags` | `{ tags }` | the new meta; doesn't touch `modified`; 400 if a tag isn't `[a-z0-9]+` |
| `POST /api/notes/:id/trash` | | meta with `trashedAt` set |
| `POST /api/notes/:id/restore` | | meta with `trashedAt: null` |
| `DELETE /api/notes/:id` | | `{ ok: true }`, deletes the folder; 409 unless trashed |
| `POST /api/trash/empty` | | `{ deleted: <count> }` |
| `POST /api/notes/:id/images` | raw PNG bytes, `Content-Type: image/png` | 201 `{ name }`; 415 if not PNG; 409 if trashed |
| `GET /api/notes/:id/images/:name` | | the PNG, `Cache-Control: private, max-age=31536000, immutable` |

Unknown notes give 404 `{ error: "Note not found" }`. Tags are de-duplicated on save.

**Uploads** are streamed to `<name>.png.upload` with no size limit. The first 8 bytes are checked
against the PNG signature, and the file is renamed into place (or deleted if it isn't a PNG).

**Search** (`q`): lowercase the query, split on whitespace, and keep notes whose *visible text*
(5.6) contains every term.

### 5.5 Users, passwords and sessions

- **Passwords**: Node's `crypto.scrypt` with a random 16-byte salt and a 64-byte key, compared with
  `timingSafeEqual`. A hash is computed even for unknown usernames, so timing doesn't reveal which
  names exist.
- **Users cache**: `users.json` is cached and re-read whenever its modification time changes, so CLI
  changes apply immediately.
- **Sessions**: a 32-byte random hex token, stored in `sessions.json` (kept in memory and written
  200ms after a change).
  - **Cookie**: `margin_session=<token>; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000` (30 days).
  - **Sliding expiry**: once more than an hour has passed since the expiry was last set, a request
    pushes it back to 30 days and re-sends the cookie.
  - **Ending**: a session ends when it expires, when its user is removed, or on logout.
- **CLI** (`cli.js`, installed in the image as `margin-user`): reads and writes `users.json`
  directly. Commands `add`, `passwd`, `remove`, `list`. Passwords are entered twice with hidden
  input, or come from `MARGIN_PASSWORD`.

### 5.6 The note format parser (`shared/format.js`)

**Lines** (`parseDoc(text)`): split on `\n`; each line gets `{ index, from, to, text, kind }`, in
this order:

1. **Code blocks**: scanning down, an opening fence line (```` ^```[^`]*$ ````) pairs with the next
   closing fence line (```` ^```\s*$ ````). Kinds are `fence-open`, `code` (each line between) and
   `fence-close`, and each line points to its block `{ open, close, index }`. If no closing fence
   follows, scanning stops and the rest is plain.
2. **Headings**: among the remaining `text` lines, `^## \{([a-z]+(?:-deep)?)\} (?=\S)` with a known
   color → kind `heading`, with `color` and `prefixLen`. Each heading starts a section
   `{ heading, end, color }` that ends at the line before the next heading or at the last line.
   Every line in a section points to it.
3. **Screenshots**: `^!\[\]\(([a-z0-9]{8}\.png)\)$` → kind `image`.
4. Everything else is `text`.

**Inline tokens** (`parseInline(lineText, offset)`) scan left to right. At each position the first
match wins:

1. `` ` `` → **code** up to the next backtick (needs at least one character inside).
2. `[` → **link** `^\[([^\]\n]+)\]\((https?://[^\s<>()[\]`]+)\)`.
3. `h` → **bare URL**: not preceded by a letter, digit or `/`; `https?://` and then non-space
   characters except `<>()[]` and backticks; trailing punctuation trimmed.
4. `=={` → **highlight** if `^==\{([a-z0-9+-]+)\}` has valid options and a closing `==` follows
   (skipping inline code and links) with at least one character between. Inside, code, links and
   URLs are parsed; highlights aren't.
5. Otherwise move on one character.

Every token has `from`/`to` (all of its syntax) and `contentFrom`/`contentTo` (the visible part):

| Type | Extra fields | Hidden in render mode |
|---|---|---|
| `hl` | `opts { color, b, u }`, `optsText` | `=={opts}` and `==` |
| `code` | `inHl` | the two backticks |
| `link` | `url` | `[` and `](url)` |
| `url` | `url` | nothing |

**Helpers**

- `parseOptions` / `serializeOptions` read and write `lime+b+u`.
- `stripInline` removes the hidden parts.
- `visibleText` gives what render mode shows (code kept; fences and screenshots dropped) and is used
  for search.
- `noteTitle` is the first line without a heading prefix and without syntax, trimmed.

### 5.7 Client

**`main.js` (app shell)**

- **State**: `{ user, notes, tags, filterTag, query, trashView, note, savedText, saveState, mode, font }`.
- **API helper**: on a 401, it reloads to show the login page (or, with unsaved changes, shows an
  error instead).
- **Owns**:
  - the note list and its colors;
  - the tag filter, tag chips and suggestions;
  - search with a 200ms debounce;
  - the trash flows;
  - saving and the save-button state (unsaved = `editor.text() !== savedText`);
  - the unsaved-changes prompts;
  - Ctrl+S / Ctrl+E;
  - the address bar (`history.replaceState`);
  - the sidebar and drawer;
  - the home link.
- **Persists per browser** (`localStorage`):
  - `margin:mode` (`render` | `raw`);
  - `margin:font` (`mono` | `prop`);
  - `margin:sidebar` (`open` | `collapsed`);
  - `margin:collapsed:<noteId>` (JSON array of collapsed heading lines).
- **Debug hook**: `window.margin.view` is the CodeMirror view.

**`editor.js` (CodeMirror setup)**

- One `EditorView`. Opening a note creates a **new `EditorState`**, which resets undo history.
- Extensions:
  - history, `drawSelection`, line wrapping;
  - the end-of-file marker field;
  - the popup;
  - the code Tab keys;
  - the default and history keymaps;
  - a **mode compartment** (render: `renderField` + `renderEditing` + class `mode-render`; raw: class
    `mode-raw`);
  - a **read-only compartment** (trashed notes);
  - spellcheck on, autocorrect and autocapitalize off;
  - an update listener (unsaved state, persisting collapsed sections, the link chip);
  - DOM handlers for paste, mousedown (Ctrl/Cmd+click links) and mousemove (Copy button hover).
- **Facets and fields**: `noteIdFacet` (for image URLs) and `collapsedField` (a set of heading lines,
  changed by the `toggleSection` effect).
- **Paste**:
  - a file that isn't `image/png` → error toast;
  - a PNG → upload, then insert `![](name)` on its own line;
  - a URL over a one-line selection → link.
- **Link chip** (touch screens): shown above the cursor when the cursor is in a link.

**`render.js` (render mode)** is a `StateField` rebuilt when the document, the selection or the
collapsed set changes. It provides decorations and **atomic ranges** (every replaced range, so the
cursor skips hidden syntax), plus data for the edit guards:

- `tokens` (all inline tokens);
- `markers` (token ranges plus their hidden pieces, for protection);
- `hidden` (replaced ranges with a kind: `marker`, `heading`, `fence`, `image`, `fold`).

Decorations by line kind:

| Kind | Decorations |
|---|---|
| title (line 1, plain, non-empty) | line class `cm-title` |
| `heading` | line class `cm-heading` with CSS vars `--sec` (color) and `--heading` (dark shade); the `## {color} ` prefix replaced by a **fold widget** (⌄); inline tokens with highlight colors dropped |
| section content | line class `cm-sec` with `--sec` (the bar is a `::before`) |
| collapsed section | from the end of the heading line to the end of the section replaced by a **⋯ widget**; those lines get no decorations |
| `fence-open` / `fence-close` | classes `cm-cb cm-cb-open/close`; unless the cursor is on the line, its text is hidden and it gets `cm-fence-hidden`; the opening fence gets a **Copy widget** |
| `code` | `cm-cb cm-cb-body`; nothing inside is parsed |
| `image` | the whole line replaced by an **image widget** (`/api/notes/<id>/images/<name>`) |
| `text` | inline tokens: hidden syntax replaced; marks `cm-hl` (+ `cm-hl-color` with `--hl`, `cm-hl-b`, `cm-hl-u`), `cm-code`, `cm-link` (with a title tooltip) |

The **end-of-file marker** is a separate field (a block widget at the end of the document), active
in both modes.

**`editing.js` (render-mode guards)**. All of Margin's own edits carry a `bypass` annotation so the
guards ignore them.

- **Change filter**: for user input and delete transactions, any token that a change touches only
  partly gets its hidden pieces suppressed (CodeMirror's `changeFilter` ranges). A change covering a
  whole token is allowed.
- **Transaction filter**: after a user deletion or replacement, it removes any `=={opts}==`, lone
  ` `` ` or `[](url)` left on the changed lines (outside code blocks).
- **Keymap** (high precedence): Backspace, Delete and Enter, following the rules in
  [3.7](#37-editing-in-render-mode). Deletions use grapheme clusters (`findClusterBreak`).
- **Code Tab keymap** (both modes): Tab / Shift+Tab when every selected line is a code line.

**`format-ops.js` (formatting engine)**. Each affected line (a heading's text, or a plain line) is
turned into a **character model**: one entry per visible character
`{ ch, pos, opts: { color, b, u }, code, link }` (hidden syntax dropped; bare URLs are plain
characters).

- The operation changes the selected characters.
- The line is **re-serialized** by grouping runs:
  - a run of equal highlight options → `=={opts}…==`;
  - inside it, a run with the same link → `[…](url)`;
  - otherwise a run of code → `` `…` ``.

  Code inside a link is dropped, because link text is plain.
- The selection is mapped back to the same visible characters.
- `formatState` computes the popup's active states. A heading's characters count as having the
  section's color.
- Line-level operations: code (inline within one line; wrap or unwrap a fenced block across lines)
  and section (add `## {blue-deep} ` without leading spaces, or remove the prefix).

**`popup.js` (formatting popup)** has three placements:

- **selection**: centered under the selection end, flipped above if needed, clamped to the window;
- **pinned**: under the palette button;
- **docked**: fixed at the bottom with 8px margins, raised by the keyboard height from
  `visualViewport`. It's used when `(max-width: 760px), (pointer: coarse)` matches.

Its keymap has the highest precedence and only takes keys while the popup is visible (and not
pinned with an empty selection). Clicking popup buttons is a `mousedown` with `preventDefault`, which
keeps the editor's focus and selection.

### 5.8 Build and deployment

- `npm run build`: `esbuild client/main.js --bundle --format=esm --minify --sourcemap --outfile=public/build/app.js`.
- **Dockerfile** (multi-stage, `node:22-alpine`):
  1. The build stage runs `npm ci` and the client build.
  2. The runtime stage runs `npm ci --omit=dev`; copies `server/`, `shared/`, `cli.js` and the built
     `public/`; and adds `/usr/local/bin/margin-user` (`node /app/cli.js "$@"`).
  3. It sets `DATA_DIR=/data` and `PORT=5555`, and runs `node server/server.js`.
- **compose.yaml**: one service `margin`, `restart: unless-stopped`, port `5555:5555`, volume
  `./data:/data`, user `${MARGIN_UID:-1000}:${MARGIN_GID:-1000}`.
- **Environment**: `DATA_DIR` (default `./data`), `PORT` (default 5555), `MARGIN_PASSWORD` (CLI only).

---

## 6. Decisions

How each open question in the original spec was settled, then features added along the way.

| Topic | Decision |
|---|---|
| Render mode | Editable (not read-only) |
| Formatting popup | Appears on text selection; later also a palette button for a bar that stays open |
| Privacy | Notes are private per user; other users' links are 404 |
| Deleting | Trash with restore; emptied only by hand |
| Search | Full-text, combined with the tag filter |
| Tag changes | Save only the tags; don't touch text or last-modified |
| Two tabs | Last write wins |
| Markdown | Only Margin's own syntax (later: inline code, code blocks, links) |
| Escaping | None; only exact syntax counts |
| Collapsed sections | Remembered per browser |
| Address bar | Always shows the current note/tag; replaces history (Back leaves the app) |
| Sidebar titles | Syntax stripped; "Untitled" when empty |
| HTTP | Plain HTTP accepted; README warns and suggests TLS via a proxy |
| Sessions | 30 days, renewed on use |
| Spelling | "color" |
| Code | Markdown backticks; no syntax highlighting; literal inside; grey panel with border; </> toggle in the popup; Copy on hover; Tab = 2 spaces |
| Sections from the popup | One click, default color `blue-deep` |
| Heading color | A heading always shows its section's color; picking a color on a heading recolors the section |
| Logo | Goes home |
| Tag suggestions | Per user, from the tags their notes currently use (no separate tag list) |
| Toolbar | Icons: save, trash, render/raw toggle, palette button |
| Look | Colorful and fresh; then no rainbows and no gradient buttons |
| Trash | Always confirm |
| Font | Render mode can switch between monospace and proportional |
| Links | Bare URLs and `[text](url)`; Ctrl/Cmd+click opens |
| Phones | Drawer sidebar, docked popup, tap chip for links |

---

## 7. Known limitations

- **Two tabs, one note**: no conflict detection; the last save silently wins.
- **Render-mode edge cases**: selecting from one line into a heading and deleting can break the
  heading so its raw syntax shows. A highlight's text can't contain `==`.
- **Syntax limits**:
  - highlights must stay on one line;
  - link text can't be formatted;
  - URLs with parentheses (some Wikipedia pages) aren't recognized;
  - an unmatched backtick next to new inline code can pair up unexpectedly.
- **Scale**: the whole note is re-parsed on every keystroke and every request reads all of a user's
  notes. That's fine at personal scale and slow for very large notes or note counts.
- **Search**: no ranking, no highlighting of matches, no typo tolerance, and accents count (`cafe` ≠
  `café`). Tags and URLs aren't searched.
- **Dialogs**: confirmations and the Link prompt use the browser's built-in boxes, which don't match
  the app's style.
- **Touch features weren't tested on a real device**: the link chip, the popup rising above the
  on-screen keyboard and long-press selection. Phone layouts were checked at phone size in a
  desktop browser only.
- **No automated tests** yet.
