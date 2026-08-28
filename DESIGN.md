---
name: Halftone Tools
description: A flat, Swiss print-effects workshop for turning images and motion into printed matter.
colors:
  paper: "#eeebe3"
  paper-2: "#ddd8ca"
  ink: "#15120d"
  accent: "#f54129"
  accent-2: "#f5882a"
  sheet: "#eeebe3"
  sheet-ink: "#15120d"
  on-accent: "#eeebe3"
  on-accent-2: "#15120d"
typography:
  display:
    fontFamily: "Archivo Expanded, Archivo, sans-serif"
    fontSize: "26px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Archivo Expanded, Archivo, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.04em"
  body:
    fontFamily: "Archivo, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  label:
    fontFamily: "Archivo, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "10.5px"
    fontWeight: 600
    lineHeight: "normal"
    letterSpacing: "0.12em"
  mono:
    fontFamily: "Space Mono, Courier New, monospace"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: "normal"
    letterSpacing: "normal"
rounded:
  none: "0"
  circle: "50%"
spacing:
  rail-x: "20px"
  page-x: "34px"
  section-y: "15px"
  control-gap: "14px"
  film-gap: "14px"
  mobile-x: "16px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.none}"
    padding: "16px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "9px 14px"
  input-field:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "8px 10px"
  stage-frame:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0"
  effect-film:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0"
---

# Design System: Halftone Tools

## Overview

**Creative North Star: "The Print Bench"**

Halftone Tools is a compact print-effects workshop: a warm paper desk, a proof sheet, registration marks, ink accents, and a filmstrip of process samples. The interface is intentionally flat and utilitarian. It should feel like a well-organized studio tool rather than a generic dashboard.

The visual language is neo-grotesque Swiss typography over a restrained paper-and-ink palette. Structure comes from hairlines, tonal surfaces, uppercase labels, and deliberate asymmetry between the control rail and the large proof area. The UI is dense enough for editing but leaves the proof sheet visually dominant.

**Key Characteristics:**
- Warm paper surfaces with a dark ink structure.
- Signal red for primary action and slot A; press mustard for secondary action and slot B.
- Flat construction with hairline dividers instead of shadows or rounded cards.
- Archivo for interface voice, Archivo Expanded for headings, and Space Mono for measurements and code-like values.
- A persistent desktop control rail that becomes a collapsible touch-friendly drawer on phones.

## Colors

The chrome uses a small, role-based palette. Light and dark themes swap the paper and ink poles while the proof sheet and accent foregrounds remain deliberately fixed.

### Primary
- **Signal red** (`{colors.accent}`): Primary actions, active slot A, active film selection, progress, and the empty-state mark.

### Secondary
- **Press mustard** (`{colors.accent-2}`): Slot B, support action, and secondary active states.

### Neutral
- **Warm paper** (`{colors.paper}`): Main application ground.
- **Recessed paper** (`{colors.paper-2}`): Stage desk and section headers.
- **Ink** (`{colors.ink}`): Primary text and structure in light mode.
- **Soft ink**: A restrained color-mix of ink and paper for metadata, notes, and secondary descriptions.
- **Proof sheet** (`{colors.sheet}`): Fixed light paper for the artboard and filmstrip thumbnails.
- **Proof ink** (`{colors.sheet-ink}`): Fixed dark marks for the artboard and selectable ASCII output.
- **Text on red** (`{colors.on-accent}`): Fixed light foreground for red controls.
- **Text on mustard** (`{colors.on-accent-2}`): Fixed dark foreground for mustard controls.

### Named Rules
**The Five-Color Chrome Rule.** Application chrome uses the named palette and its opacity/color-mix derivatives. Effect artwork may use its own user-selected inks, ramps, and separations.

**The Author-Blue Exception.** The author link is intentionally browser blue rather than an application token. It is the one approved chrome exception because the contrast draws attention to authorship and makes the credit read as a conventional external link.

## Typography

**Display Font:** Archivo Expanded (with Archivo, Helvetica Neue, Helvetica, and Arial fallbacks)

**Body Font:** Archivo (with Helvetica Neue, Helvetica, and Arial fallbacks)

**Label/Mono Font:** Space Mono is reserved for measurement-like values, ASCII content, and compact data.

**Character:** Archivo Expanded gives the workshop a firm, editorial title voice; Archivo keeps the controls neutral and legible. Uppercase labels and measured tracking make the interface read like a printed instrument panel, not a consumer app.

### Hierarchy
- **Display** (800, 26px, tight line-height): Empty-state instruction and the main invitation to load media.
- **Title** (700, 13px, tight line-height, `0.04em`, uppercase): Section and effect headings.
- **Body** (400, 13px, `1.45` line-height): Explanatory notes and supporting copy.
- **Label** (600, 10.5px, `0.12em`, uppercase): Control names and compact metadata.
- **Value** (700, 11px, tabular numerals): Slider readouts and active measurements.
- **Mono** (400–700, 10–12px): Timecodes, text inputs, ASCII previews, and other data where character alignment matters.

### Named Rules
**The Two-Voice Rule.** Use Archivo Expanded for hierarchy, Archivo for interaction, and Space Mono only when alignment or data semantics justify it.

**The Uppercase Utility Rule.** Labels, controls, metadata, and action text are uppercase with tracking. Do not apply this treatment to explanatory sentences or user-entered content.

## Layout

Desktop uses a two-column application shell: a fixed control rail on the left and a flexible work area on the right. The rail is 340px wide on large screens and reduces to 300px at 1024px. The work area contains the proof stage above and the effect filmstrip below.

The stage uses generous outer padding on desktop (`32px 34px 22px`) and a tighter tablet rhythm (`22px 22px 16px`). The proof frame is centered inside the available stage and keeps the full media aspect ratio visible. Registration ticks sit 10px from its corners.

At 720px and below, the shell becomes a single viewport-tall column: masthead, proof stage, effect strip, then the control drawer. The stage occupies roughly 35dvh, the rail fills the remaining height, and only the control rail and horizontal filmstrip scroll. Phone content uses 16px side padding; desktop filmstrip and stage content use 34px side padding.

The export panel is a centered overlay up to 860px wide. It uses five columns on desktop and two columns below 620px, with the final animated tier spanning the last mobile row.

## Elevation & Depth

This is a flat system. It has no drop shadows, blur, gradients used as decoration, or floating-card elevation. Depth comes from tonal layering between paper and recessed paper, a dark scrim behind the export panel, and precise 1px structure lines.

### Shadow Vocabulary
- **None:** Do not introduce `box-shadow` as a default surface treatment.

### Named Rules
**The Flat Proof Rule.** Use tonal surfaces and hairlines to separate regions; do not simulate depth with shadows.

**The Hairline Rule.** Structural borders and icon strokes use 1px. A 2px outline is reserved for selected filmstrip items, and a 3px marker is reserved for an active stacked pass.

## Shapes

The form language is square and print-like: all ordinary controls, frames, tiers, and thumbnails have zero radius. Circular geometry is reserved for range thumbs and intentional registration/mark motifs. SVG icons use simple geometry and a consistent stroke rather than Unicode glyphs or emoji.

Borders are flat hairlines. The proof frame and thumbnail boxes are edged, not rounded. Focus rings are 1px accent outlines with a 2px offset. The selected filmstrip item uses a 2px accent outline inset by 2px.

## Components

### Buttons
- **Shape:** Square, unrounded controls (`{rounded.none}`).
- **Primary:** Signal-red fill with fixed light text; the rail Export action uses full-width `16px` padding.
- **Secondary:** Transparent or ink treatment with a 1px border, Archivo 11px bold uppercase text, and `9px 14px` padding.
- **Hover / Focus:** Hover changes the fill to ink; focus uses a visible 1px accent outline with a 2px offset. Touch layouts raise interactive targets to at least 44px.

### Inputs / Fields
- **Style:** Flat, transparent fields with an ink hairline. Selects and text inputs use `8px 10px` padding on desktop.
- **Ranges:** Hairline tracks with small round thumbs in the active slot color; touch layouts enlarge the hit area and thumb without thickening the visible track.
- **Toggle:** A square 40×20 track with a sliding square knob; the checked track uses the current slot accent.
- **Focus:** Accent outline with a 2px offset; generated fields carry an accessible name.

### Cards / Containers
- **Stage frame:** Recessed paper surface with a 1px border, centered proof sheet, and registration ticks.
- **Control blocks:** Recessed paper headers, flat bodies, and 1px dividers. No card shadow or radius.
- **Export panel:** Warm paper modal with a 1px border and hairline-separated tier columns.

### Navigation
- **Masthead:** A compact horizontal brand bar with a three-square mark, Expanded title, and right-aligned workshop credit. On phones the credit is hidden and the brand padding tightens.

### Chips
- **Effect film:** Each effect is a 118×88 paper thumbnail on desktop and 68×51 on phones, with a compact uppercase caption. The selected item receives a 2px accent outline; slot B switches that outline to mustard.
- **A/B target:** A small segmented target control uses red for active A and mustard for active B. On touch layouts the hit areas are at least 44px.

### Signature Component
- **Proof stage:** The proof sheet is the visual center of the product. It preserves the source aspect ratio, keeps the complete image visible, and can be overlaid by selectable ASCII output without changing the surrounding paper frame.

## Do's and Don'ts

### Do:
- **Do** use the five named palette roles for application chrome.
- **Do** preserve the warm paper / recessed paper / ink hierarchy in both themes.
- **Do** use 1px hairlines for structure and 2px only for selected filmstrip emphasis.
- **Do** use Archivo Expanded for display hierarchy and Archivo for interface controls.
- **Do** use Space Mono for time, measurement, ASCII, and other aligned data.
- **Do** keep the proof sheet visually dominant and preserve the complete media aspect ratio.
- **Do** provide 44px minimum touch targets on coarse-pointer and narrow layouts.
- **Do** keep the author link browser blue as the approved exception.

### Don't:
- **Don't** add shadows, rounded cards, decorative blur, or glass effects.
- **Don't** introduce arbitrary chrome colors or replace the author-link exception with an app token.
- **Don't** use Unicode glyphs or emoji as interface icons; draw simple SVG geometry instead.
- **Don't** use monospace as a generic technical costume.
- **Don't** crop loaded media in the proof stage or allow the stage to overflow the viewport.
- **Don't** create a new border weight without first updating this system.