# Cursors and native widgets on the target

The target pane is an offscreen window drawn onto a canvas. Everything the
page does through its pixels comes through; two things a page does through
the *window* did not, and both mattered most in solo Target, where the
native pane is not there to fall back on.

## The cursor

Chromium reports every cursor change on the offscreen window
(`webContents` `cursor-changed`) but has nothing to show it on. Main maps
the reported type to CSS (`shared/cursor.ts`) and the canvas wears it: the
hand over a link, the I-beam over text, a resize arrow at a splitter, a
page's own image cursor as that image. The mapping has two traps worth
knowing: Chromium calls the arrow `pointer` and the hand `hand`. Anything
unrecognised is the arrow, and a custom cursor is accepted only as the PNG
data URL Electron hands over.

The canvas shows the page cursor only at rest. A view gesture's cursor —
the grab hand for a pan, the magnifier in fit with Option held, the
crosshair in inspect — says what a press would do *here*, and outranks what
the page would do *there*.

Per tab: every target reports, the canvas keeps the one in front, and a tab
switch re-sends the incoming tab's last cursor, since Chromium only reports
a change.

## `<select>` popups

A select's popup is a widget Chromium draws outside the page's compositor
— on macOS a native menu hung on the window. Offscreen there is nothing to
hang it on: the select reports itself open, swallows the keyboard, and
shows nothing. (Measured: after a click, `select:open` was true and
ArrowDown changed nothing.)

So the target's preload catches the press before Chromium acts on it:

1. A mousedown on a `<select>` (or Space / ArrowDown / ArrowUp on a focused
   one) is `preventDefault`ed, the select is focused, and its rows are sent
   to main — one menu group per `<optgroup>`, disabled rows left out,
   values being option indexes so a repeated label still maps to one row.
2. Main hands them to the chrome, which draws them in the overlay menu the
   toolbar's own controls use, anchored over the select's box on the
   canvas (through the text scale and the pane's magnification).
3. The pick goes back to the preload, which sets `selectedIndex` and fires
   `input` and `change` on the element, bubbling, as a real pick does. A
   dismissal changes nothing. The page's own `mousedown`, `focus` and
   `click` handlers run as before; only Chromium's default action is
   replaced.

The hook is the target's alone: the same preload runs in the native pane,
where Chromium's own popup works, and only the offscreen window names
itself to it (`additionalArguments`). Listbox selects (`multiple`, or a
`size` above 1) render in-page and are left to Chromium. Menus hold up to
a thousand rows, which covers a country list.

## What is still native, and what to expect

| Widget | Offscreen behaviour | What to do |
| --- | --- | --- |
| `<input type=date>` and friends | The picker never opens; typing into the field works | Type the value; use the native pane for the picker |
| `<input type=color>` | Nothing opens | Native pane |
| `<input type=file>` | Untested | Native pane |
| `alert()` / `confirm()` / `prompt()` | Dismissed unseen after ~300 ms; the page is not blocked (measured) | Native pane to read the message |
| `title` tooltips | Not shown | — |
| Context menus | Not shown; right-click is the app's | — |

These are Chromium widgets too, drawn the same way, and the same approach
would carry them one by one if a real page needs one. Tooltips could be
drawn like the select rows; the pickers are large, and typing is the
faster path anyway.
