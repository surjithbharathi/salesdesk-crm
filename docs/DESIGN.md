# Web app design notes (web/)

**Subject:** Devi Industries sells wooden cold-press oil machines and food-processing equipment from Coimbatore. The people using this app are callers and managers who work Tamil and English, all day, on leads that arrive from IndiaMART, ads and WhatsApp. The app's job: tell each person which lead to call next, and tell the owner where enquiries turn into orders and where they are lost.

## Design plan
**Concept: the press line.** An oil press takes a wide intake and delivers a narrow, valuable stream. The dashboard opens with that picture drawn from real numbers: all enquiries of the period flow left to right through *called → answered → quotation → order*, narrowing as leads drop out, with the loss named at each step. Everything else is quiet and built for speed.

- **Color (named):** Cast iron `#1E2629` (rail, plates) · Mist `#ECEFEC` (canvas, a cool green-grey, not cream) · Ghani wood `#2A1F16` (ink, primary buttons) · Oil `#E9A800` (the stream and one marker, never body text) · Leaf `#2F7D5B` (won, answered) · Kumkum `#BF3B2B` (late, lost, junk). Dark mode keeps the same roles on `#141A1C`.
- **Type:** Catamaran for everything (it is drawn for Tamil and Latin together, so Tamil names and English labels sit in one voice). Big Shoulders Display only for page titles and counts, the condensed lettering of machine nameplates. Sentence case throughout; no all-caps labels, no eyebrows.
- **Layout:** left rail (dark) + one working column. Dashboard: press line across the top, a ruled work list under it (counts on nameplates, one line of plain words each), then a segmented bar for "where leads are now". Leads: pill filters, dense table, keyboard cursor, slide-in lead panel. Source report: sortable table with thin bars, best/worst marks, plain-language findings above it. Left-aligned text; numbers right-aligned in tables.
- **Principles:** one memorable thing (the press line); square-ish plates for counts, pills for state, hairlines instead of boxes; motion only where it explains (the stream fills in once on load, the panel slides in when a lead is opened); every action available by keyboard.

## Review against the brief (what was changed)
- First draft was a dark-steel canvas with a gold accent, which is the "near-black plus single bright accent" default. Changed: light mist canvas, dark steel limited to the rail and the count plates, gold reserved for the stream.
- First draft used a grid of equal stat cards. Changed to a ruled work list ordered by urgency plus the press line, so the dashboard has hierarchy instead of identical tiles.
- Rejected numbered steps, eyebrow labels, monospace data labels, arrows on buttons and gradient washes.
- Copy is written for callers: "Leads nobody has called yet", "Follow-ups due today", "Late follow-ups".

## Quality floor
Responsive to phone width, visible focus rings, `prefers-reduced-motion` respected, colour never the only signal (shapes and words accompany it), contrast checked for text on every surface, no inline styles (the server's CSP forbids them), fonts self-hosted.
