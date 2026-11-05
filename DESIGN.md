# DESIGN.md

Durable visual decisions for QRAFT. Product truth is in PRODUCT.md.

## Mode

**Operate.** The visitor is completing a two-sided task with irreversible,
money-moving steps. Scanability, state legibility and keyboard reach outrank
expression. Character arrives through precision — type, rhythm, and one
restrained accent system — not through decoration.

## The world: instrument on paper

Monochrome on warm paper, in the tradition of a precision instrument's
faceplate rather than a crypto dashboard. Ink on paper, hairline rules, deep
negative space, data set in a mono face so columns of hex and ETH align.

Light, not dark, and chosen from the use scene: a laptop on a conference table
under bright hall lighting, and a projector behind it. Paper holds up in both;
a dark neon surface blooms on a projector and reads as the category default
the brief rejects.

### Accent: the spectral hairline

Rainbow is a hairline, never a field. Six stops — red, orange, yellow, green,
blue, violet, slightly desaturated — appear as a 2px gradient and nowhere
else:

- the active tab's underline
- progress rails (deposit submission, proof generation)
- the seal on a generated note card
- the focus ring's outer edge

No gradient text. No gradient fills behind cards. No glow.

### Accent: one hue per lifecycle state

Transaction and note states each get exactly one hue, used on a 7px dot and
on the status label's text, both at ≥4.5:1 on paper:

| state | hue token |
|---|---|
| idle / neutral | `--state-neutral` |
| pending, preparing, proving | `--state-pending` (amber) |
| confirmed | `--state-good` (green) |
| spent | `--state-spent` (violet) |
| outcome unknown | `--state-unknown` (blue) |
| failed, invalid, insufficient | `--state-bad` (red) |

The rainbow therefore only becomes visible *across* states, never inside one.

## Type

- **Inter Tight** — interface. 400/500/600. Headings at -0.03em to -0.04em.
- **IBM Plex Mono** — hashes, addresses, note handles, and every value in a
  data row. Measurement, not costume: these are read character by character
  and must align in a column. Its dotted zero is an asset there.
- The **headline amount is set in the sans**, not the mono. A hero amount is
  read as one shape rather than compared digit by digit, and the mono's dotted
  zero reads as code at display size.

Scale steps are obvious: 11px label → 13px secondary → 15px body → 20px
subhead → 32px/44px amount. Body measure never exceeds 70ch.

## Surface

Soft, not glassy. White cards on warm paper, 1px neutral-200 border, radius
14px, and a two-layer shadow with real offset
(`0 1px 2px -1px`, `0 12px 28px -18px`). Nested cards are not used; a card's
interior is divided by hairline rules instead.

## Spacing

8px base. Tight inside a group (8/12px), generous between groups (28/40px),
more space above a heading than below it. The primary action stays above the
fold at 1440×900 and at 1280×800.

## Motion

One authored moment: a step transition that slides 10px and clears a 4px blur
on an exponential ease-out over 320ms, with the outgoing step cross-fading.
Progress rails animate their spectral gradient's position, not their hue.
Everything else is a 120ms color/border transition. All of it is removed under
`prefers-reduced-motion`.

## Browser surfaces

Themed, not defaulted: selection, caret, scrollbar, focus ring, underline
offset, and tabular numerals on all data.

## Refused for this project

Padlock, shield, eye-with-slash and keyhole imagery; terminal green; matrix
rain; mono as a technical costume on prose; a hero metric; kickers; cards as
page scaffold; emoji icons; "military-grade", "unhackable", "anonymous"
superlatives.
