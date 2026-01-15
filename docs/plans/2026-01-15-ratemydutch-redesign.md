# RateMY Dutch - Frontend Redesign

**Date:** 2026-01-15
**Status:** Approved
**Approach:** Boutique Course Platform (Masterclass-style premium)

## Overview

Rebrand and redesign the Inburgeringsexamen Practice App to "RateMY Dutch" with a premium, editorial aesthetic. The design combines Masterclass-level polish with academic prestige, using a navy/cream palette and elegant serif typography.

## Design Vision

| Attribute | Direction |
|-----------|-----------|
| **Core Feeling** | Premium & Exclusive |
| **Paper Element** | Subtle texture (refined, not literal) |
| **Color Palette** | Navy & Cream (academic prestige, Dutch connection) |
| **Typography** | Elegant serif throughout (editorial feel) |
| **Approach** | Boutique Course Platform with dramatic contrast |

## Color System

### Primary Colors

```css
:root {
  --navy-deep: #1a2332;      /* Hero background, headers, primary buttons */
  --navy-mid: #2d3a4f;       /* Sidebar hover, secondary elements */
  --cream: #f8f5f0;          /* Main content background */
  --cream-dark: #ebe6df;     /* Cards, input backgrounds */
  --warm-white: #fdfcfa;     /* Highlight areas, modals */
}
```

### Accent Colors

```css
:root {
  --dutch-orange: #d4652a;   /* Success states, completion, CTAs */
  --soft-gold: #c9a962;      /* Premium highlights, scores */
  --error-red: #a63d2f;      /* Muted terracotta for errors */
}
```

### Paper Texture

- Subtle noise/grain texture at 2-3% opacity on cream backgrounds
- Cards elevated with soft shadows: `box-shadow: 0 2px 8px rgba(26,35,50,0.08)`

## Typography System

### Font Stack

| Role | Font | Fallback | Usage |
|------|------|----------|-------|
| **Display** | Libre Baskerville | Georgia, serif | Hero title, section headers |
| **Body** | Crimson Pro | Times New Roman, serif | Exercise text, instructions, feedback |
| **UI/Labels** | Cormorant Garamond | serif | Buttons, navigation, labels |

### Type Scale

```css
:root {
  --text-hero: clamp(3rem, 8vw, 5.5rem);
  --text-h1: clamp(2rem, 4vw, 3rem);
  --text-h2: clamp(1.5rem, 3vw, 2rem);
  --text-body: clamp(1rem, 1.5vw, 1.125rem);
  --text-small: 0.875rem;
}
```

### Typography Details

- Headlines: `letter-spacing: -0.02em` (tight, editorial)
- Body: `line-height: 1.7` (generous readability)
- Labels: `letter-spacing: 0.05em` (slightly tracked)

## Layout Structure

### Hero Section

- Full viewport height on first load
- Navy deep background
- "RateMY Dutch" centered in Libre Baskerville, cream color
- Tagline: "Master your Dutch. Prepare with precision."
- Single CTA button
- Subtle scroll indicator

### Main Content Layout

```
Sidebar (240px fixed)  |  Main Exercise Area (flexible)
─────────────────────────────────────────────────────────
Navy accents on cream  |  Exercise cards on cream
                       |  Paper-like elevated cards
```

### Sidebar Design

- Cream background with subtle left navy border
- Section headers: small caps, Cormorant Garamond, tracked
- Exercise items: minimal text links (not chunky buttons)
- Active state: navy background, cream text
- Completed: subtle checkmark, muted styling

### Exercise Cards

- Background: `#fdfcfa` (warm white)
- Shadow: soft "lifted paper" effect
- Border: `1px solid rgba(26,35,50,0.06)`
- Padding: 2rem minimum
- Optional: diagonal corner fold accent

## Interactive Elements

### Buttons

```css
.btn-primary {
  background: var(--navy-deep);
  color: var(--cream);
  padding: 0.875rem 2rem;
  border: none;
  border-radius: 0; /* Sharp = editorial */
  font-family: 'Cormorant Garamond', serif;
  font-size: 0.9rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  transition: all 0.3s ease;
}

.btn-primary:hover {
  background: var(--navy-mid);
  box-shadow: 0 4px 12px rgba(26,35,50,0.15);
}

.btn-secondary {
  background: transparent;
  border: 1px solid var(--navy-deep);
  color: var(--navy-deep);
}

.btn-secondary:hover {
  background: var(--navy-deep);
  color: var(--cream);
}
```

### Writing Area (Legal Pad Feel)

```css
.writing-area {
  background:
    repeating-linear-gradient(
      transparent,
      transparent 1.75rem,
      rgba(26,35,50,0.03) 1.75rem,
      rgba(26,35,50,0.03) 1.8rem
    ),
    #fffef9;
  border: none;
  box-shadow: inset 0 1px 3px rgba(26,35,50,0.08);
  font-family: 'Crimson Pro', serif;
  font-size: 1.1rem;
  line-height: 1.8rem;
  padding: 1.5rem;
}

.writing-area:focus {
  outline: none;
  box-shadow:
    inset 0 1px 3px rgba(26,35,50,0.08),
    0 0 0 3px rgba(201,169,98,0.2);
}
```

### Mode Tabs (Schrijven/Lezen)

- Editorial underlined style, not colorful pills
- Active: navy text, 2px underline, bolder weight
- Inactive: muted gray, no underline
- Hover: text darkens, underline fades in

## Motion & Animation

| Element | Animation |
|---------|-----------|
| Hero title | Fade up (0.6s ease-out) |
| Hero tagline | Fade up (0.6s, 0.3s delay) |
| Hero CTA | Fade up (0.6s, 0.5s delay) |
| Card entrance | Fade + rise, staggered 0.1s |
| Button hover | Background 0.3s, shadow lift |
| Sidebar items | Background slides from left |
| Score numbers | Count up animation |

## AI Grading Display

### Assessment Card Structure

- Navy header bar with "ASSESSMENT" title
- Total score prominent (right-aligned)
- Individual rubric scores as thin horizontal bars
- Gold fill (`#c9a962`), gray empty (`#e5e2dc`)
- Feedback text in Crimson Pro below

### Score Bar Styling

```css
.score-bar {
  height: 4px;
  background: #e5e2dc;
  border-radius: 0; /* Sharp, editorial */
}

.score-bar-fill {
  height: 100%;
  background: var(--soft-gold);
  transition: width 0.6s ease-out;
}
```

## Feedback States

| State | Color | Style |
|-------|-------|-------|
| Success | `#d4652a` (Dutch orange) | Subtle checkmark |
| Error | `#a63d2f` (terracotta) | Muted, not harsh |
| Loading | Navy | Elegant pulsing dots |
| AI Grading | Navy | Typewriter-style dots |

## Responsive Breakpoints

### Mobile (< 768px)

- Hero: full-height, scaled text
- Sidebar: hamburger menu (navy icon)
- Cards: full-width stack
- Mode tabs: full-width toggle

### Tablet (768px - 1024px)

- Sidebar: collapsible drawer (200px)
- Two-column maintained

### Desktop (> 1024px)

- Full experience
- Max content width: 1200px
- Generous margins

## Font Loading

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Crimson+Pro:ital,wght@0,400;0,500;1,400&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
```

## Implementation Notes

- All styling inline in `index.html` (current architecture)
- CSS custom properties for theming consistency
- No external CSS frameworks
- Paper texture via CSS (gradient or base64 inline SVG)
- Animations via CSS (no JS libraries needed)

## Avoiding Generic AI Aesthetics

Per the frontend-design skill, this design specifically avoids:

- Generic fonts (Inter, Roboto, Arial)
- Purple gradients on white (the current design)
- Rounded pill buttons everywhere
- Cookie-cutter card layouts
- Harsh, saturated colors

And embraces:

- Distinctive serif typography with character
- Dominant navy with sharp cream/gold accents
- Editorial asymmetric layouts
- Atmospheric paper textures
- Sharp corners (editorial, not friendly-rounded)
- Restrained, purposeful motion
