---
name: RAG Study Helper Enterprise
description: Evidence Desk — calm, precise, evidence-led enterprise RAG console
colors:
  primary: "#015085"
  primary-hover: "#003f77"
  primary-active: "#003467"
  primary-soft: "#e4f0fc"
  on-primary: "#f9fcff"
  bg: "#fcfeff"
  surface: "#f7fbfe"
  surface-raised: "#ffffff"
  sidebar: "#f2f8fd"
  ink: "#182028"
  ink-secondary: "#3f4952"
  ink-muted: "#565f67"
  border: "#d1d8df"
  border-strong: "#b0b9c1"
  focus: "#1867a3"
  success: "#156f41"
  success-soft: "#e0f5e6"
  warning: "#a36e09"
  warning-soft: "#fef0d4"
  danger: "#a83634"
  danger-soft: "#ffe7e4"
  info: "#296b88"
  info-soft: "#def2fc"
typography:
  headline:
    fontFamily: "IBM Plex Sans, Noto Sans SC, Microsoft YaHei, PingFang SC, Segoe UI, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "normal"
  title:
    fontFamily: "IBM Plex Sans, Noto Sans SC, Microsoft YaHei, PingFang SC, Segoe UI, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "normal"
  body:
    fontFamily: "IBM Plex Sans, Noto Sans SC, Microsoft YaHei, PingFang SC, Segoe UI, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "IBM Plex Sans, Noto Sans SC, Microsoft YaHei, PingFang SC, Segoe UI, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "normal"
  mono:
    fontFamily: "IBM Plex Mono, Cascadia Code, Consolas, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: "normal"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  full: "999px"
spacing:
  "1": "0.25rem"
  "2": "0.5rem"
  "3": "0.75rem"
  "4": "1rem"
  "5": "1.25rem"
  "6": "1.5rem"
  "8": "2rem"
  "10": "2.5rem"
  "12": "3rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
    padding: "0 0.75rem"
    height: "2.25rem"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
  button-secondary:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 0.75rem"
    height: "2.25rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.md}"
    padding: "0 0.75rem"
    height: "2.25rem"
  nav-link:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.md}"
    padding: "0 0.5rem"
    height: "2.25rem"
  nav-link-active:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: "0 0.5rem"
    height: "2.25rem"
  status-pill:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    padding: "0 0.5rem"
    height: "1.5rem"
  empty-panel:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "1.25rem"
  language-option:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.sm}"
    padding: "0 0.5rem"
    height: "1.75rem"
  language-option-selected:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary}"
    rounded: "{rounded.sm}"
    padding: "0 0.5rem"
    height: "1.75rem"
---

# Design System: RAG Study Helper Enterprise

## 1. Overview

**Creative North Star: "The Evidence Desk"**

Source of truth: `frontend/src/styles/tokens.css` plus CSS Modules under `frontend/src/components` and `frontend/src/layouts`. This document replaces the init seed with implemented values.

Desktop-first product UI for enterprise RAG operations: OIDC session, streaming Q&A shell routes, knowledge ops placeholders, evaluation/job shells, and system health. Design serves the task. Surfaces feel like a professional knowledge operations desk — dense for status and permissions, quiet for reading answers and evidence.

Aesthetic strategy is **Restrained**: cool-tinted neutrals carry almost all surface area; one cobalt primary marks primary action, selection, and focus only. Motion is state-only (150–250ms). Typography is IBM Plex Sans (plus CJK fallbacks) for chrome and IBM Plex Mono for audit-grade facts. Locales are zh-CN / en-US; Chinese UI uses the same type ramp with Noto Sans SC / Microsoft YaHei / PingFang SC fallbacks.

The system rejects purple-blue AI gradients, neon glow, cyan-on-dark sci-fi chrome, decorative glassmorphism, identical card grids, nested cards, vanity hero metrics, chatbot-toy aesthetics, over-animation, and default shadcn sameness.

**Key Characteristics:**
- Evidence inspectability over decorative polish
- Cool operational cobalt accent ≤10% of any screen
- Sans UI + mono only for IDs, metrics, and technical evidence
- Flat-by-default elevation; 1px borders and tonal layers
- State-only motion with `prefers-reduced-motion` hard override
- Bilingual product strings; never monospace Chinese body copy

## 2. Colors

Restrained cool-ink palette. **Canonical values are OKLCH** in `tokens.css`; hex below is an sRGB approximation for tooling that requires hex.

### Primary
- **Operational Cobalt** (`oklch(0.42 0.11 247)` / `#015085`): Primary buttons, brand mark, selected nav, key links.
- **Cobalt Hover / Active** (`oklch(0.36 0.12 247)` / `#003f77`, `oklch(0.32 0.11 247)` / `#003467`): Interactive depth on primary fills.
- **Cobalt Soft** (`oklch(0.95 0.02 247)` / `#e4f0fc`): Selected nav background, language selected chip, soft selection.
- **On Primary** (`oklch(0.99 0.005 247)` / `#f9fcff`): Text/icons on primary fills.

### Neutral
- **Canvas** (`oklch(0.995 0.003 247)` / `#fcfeff`): App body background — pure cool near-white, not cream/sand.
- **Surface** (`oklch(0.985 0.006 247)` / `#f7fbfe`): Subtle panels, chips, secondary fills.
- **Surface Raised** (`oklch(1 0 0)` / `#ffffff`): Cards, menus, login card, empty-state panels.
- **Sidebar** (`oklch(0.975 0.01 247)` / `#f2f8fd`): App shell sidebar / mobile drawer.
- **Ink** (`oklch(0.24 0.02 247)` / `#182028`): Body text and headings (≥7:1 on canvas).
- **Ink Secondary** (`oklch(0.4 0.02 247)` / `#3f4952`): Supporting copy, inactive nav.
- **Ink Muted** (`oklch(0.48 0.018 247)` / `#565f67`): Labels, kickers, meta.
- **Border / Border Strong** (`oklch(0.88 0.012 247)` / `#d1d8df`, `oklch(0.78 0.016 247)` / `#b0b9c1`): Structural 1px edges.
- **Focus** (`oklch(0.5 0.12 247)` / `#1867a3`): `:focus-visible` ring only.

### Status (operational only)
- **Success** (`oklch(0.48 0.11 155)` / `#156f41`) + soft fill — healthy API / ok jobs; pair with ● marker.
- **Warning** (`oklch(0.58 0.12 75)` / `#a36e09`) + soft fill — degraded readiness; pair with ▲.
- **Danger** (`oklch(0.5 0.15 25)` / `#a83634`) + soft fill — errors / destructive actions; pair with ■.
- **Info** (`oklch(0.5 0.08 230)` / `#296b88`) + soft fill — loading/checking; pair with … .

### Named Rules
**The One Accent Rule.** Primary cobalt occupies ≤10% of any screen. Rarity signals actionability.

**The Status Is Not Brand Rule.** Success/warning/danger/info appear only for real operational state — never as decorative chrome.

**The Cool Canvas Rule.** Body background stays near-white with tiny chroma toward hue 247. Cream/sand/beige body tints are prohibited.

## 3. Typography

**Display / UI Font:** IBM Plex Sans with CJK stack `"Noto Sans SC", "Microsoft YaHei", "PingFang SC"` then system sans.
**Body Font:** Same family. Fixed rem scale (not fluid clamp).
**Mono Font:** IBM Plex Mono (`Cascadia Code`, `Consolas` fallbacks) for IDs, metrics, hashes, claim values, request IDs.

**Character:** Precise, operational, bilingual. Ratio ≈1.125–1.2 between steps. Mono marks “audit this fact”; sans marks “interface.”

### Hierarchy
- **Headline** (600, 1.375rem / `--text-2xl`, line-height 1.25): Page titles (`h1`).
- **Title** (600, 1.125rem / `--text-xl`): Section titles (`h2`).
- **Section** (600, 1rem / `--text-lg`): Nested headings (`h3`).
- **Body** (400, 0.875rem / `--text-md`, line-height 1.5; prose max ~70ch): Descriptions, empty-state copy.
- **Label** (500, 0.8125rem / `--text-sm`): Nav items, buttons, meta chips.
- **Caption / Mono** (400–600, 0.75rem / `--text-xs`): Kickers, status pills, mono evidence.

### Named Rules
**The Evidence Mono Rule.** Anything copyable into a ticket or audit trail renders in mono with tabular nums.

**The No Display Font Rule.** No display serifs, scripts, or gradient text in product UI.

**The CJK Body Rule.** Chinese product copy uses the sans stack; never force mono on Chinese body text.

## 4. Elevation

Flat by default. Depth = surface steps (canvas → sidebar/surface → raised panel) + 1px borders. Shadows only when a surface floats.

### Shadow Vocabulary
- **Resting surfaces:** no shadow.
- **Menu / user menu** (`--shadow-menu`: `0 4px 16px oklch(0.24 0.02 247 / 0.1)`): Dropdown menus.
- **Float** (`--shadow-float`: `0 8px 24px oklch(0.24 0.02 247 / 0.12)`): Reserved for higher floating UI (toasts/dialogs).

### Named Rules
**The Flat-By-Default Rule.** Non-floating surfaces never cast a shadow. Cards are not elevated for decoration.

## 5. Components

### Buttons (`Button.module.css`)
- **Shape:** 6px radius (`--radius-md`), min-height 2.25rem, horizontal padding 0.75rem, label 0.8125rem / 500.
- **Primary:** Cobalt fill + on-primary text; hover/active deepen L.
- **Secondary:** Raised white + border; hover strengthens border.
- **Ghost:** Transparent + secondary ink; hover soft ink wash.
- **Danger:** Danger fill + near-white text.
- **States:** default, hover, active, disabled (opacity 0.55), focus-visible ring.
- **Motion:** 150ms color/opacity with `--ease-out`.

### Status pills (`StatusPill`)
- Pill radius full; marker glyph + label (color-blind safe).
- Tones: ok / degraded / error / unknown / loading.
- Optional mono class for technical labels.

### Navigation (`AppShell`)
- Desktop grid: sidebar 15.5rem (collapsed 4.25rem) + sticky header 3.25rem.
- Nav links: 2.25rem height, secondary ink; active = primary-soft + primary text.
- Mobile: drawer + overlay (`--z-overlay` / `--z-modal`); header menu button.
- Collapse control is a secondary bordered button, not a decorative icon-only control without label.

### Empty state panel
- Raised surface, 8px radius, 1px border, 1.25rem padding.
- Kicker (muted xs) → title → description (prose max) → optional steps list → note strip → actions.

### Language switcher
- Segmented control: bordered surface track; selected option uses primary-soft + primary text and inset ring.
- Accessible: `role="group"`, `aria-current` / `aria-pressed` on selected language; no flag icons.
- Labels: 中文 / English.

### User menu
- Trigger: bordered raised chip with mono avatar initials + user id.
- Menu: raised surface, menu shadow, sections with mono IDs and claim values; role labels translated with original claim in `title`.

### Forms / inputs (current shell)
- Login has no password fields (SSO only). Future fields should use 1px border, md radius, focus ring via `--color-focus`.

### Request ID / technical details
- Mono id + copy action; expandable technical details for server Problem Details (never machine-translate detail).

## 6. Do's and Don'ts

### Do:
- **Do** lead with evidence, status, and request_id over decorative empty theater.
- **Do** keep primary cobalt rare (≤10%) for action/selection/focus only.
- **Do** use IBM Plex Sans (+ CJK fallbacks) for UI and IBM Plex Mono only for audit facts.
- **Do** design desktop density first; collapse sidebar structurally under ~900px.
- **Do** use 150–250ms state transitions (`--duration-fast|base|slow`) with `--ease-out`.
- **Do** pair status color with shape/label markers (● ▲ ■ …).
- **Do** keep `document.documentElement.lang` in sync with zh-CN / en-US.
- **Do** preserve server error detail under “技术详情 / Technical details” while localizing titles/actions.

### Don't:
- **Don't** use purple-blue “AI product” gradients.
- **Don't** use neon glow, cyan-on-dark sci-fi chrome, or decorative glassmorphism.
- **Don't** ship full-screen grids of identical rounded cards or nested cards.
- **Don't** invent hero metrics / vanity dashboards without operational meaning.
- **Don't** use chatbot-toy aesthetics or mascot-led AI UI.
- **Don't** over-animate or choreograph page-load sequences.
- **Don't** ship default shadcn/template SaaS sameness with no product voice.
- **Don't** use side-stripe borders (`border-left`/`border-right` > 1px) as accent decoration.
- **Don't** use gradient text (`background-clip: text`).
- **Don't** use cream/sand/beige body backgrounds as a “warm professional” default.
- **Don't** store access tokens in localStorage (locale preference key only: `evidence-desk:locale`).
- **Don't** put Chinese body copy in monospace.
