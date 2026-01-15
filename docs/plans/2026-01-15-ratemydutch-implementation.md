# RateMY Dutch Redesign - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the current purple-gradient app into "RateMY Dutch" with premium navy/cream editorial design.

**Architecture:** Single-file redesign - all changes in `index.html` which contains inline CSS and JS. Progressive implementation: CSS variables first, then structure, then components, then polish.

**Tech Stack:** HTML5, CSS3 (custom properties, gradients, animations), Vanilla JS, Google Fonts

---

## Task 1: Add Google Fonts & CSS Variables Foundation

**Files:**
- Modify: `index.html:1-50` (head section)

**Step 1: Add Google Fonts link in head**

Add after the existing `<meta>` tags:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Crimson+Pro:ital,wght@0,400;0,500;1,400&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
```

**Step 2: Replace CSS reset with new variables**

Replace the existing `<style>` opening with:

```css
<style>
    :root {
        /* Colors */
        --navy-deep: #1a2332;
        --navy-mid: #2d3a4f;
        --cream: #f8f5f0;
        --cream-dark: #ebe6df;
        --warm-white: #fdfcfa;
        --dutch-orange: #d4652a;
        --soft-gold: #c9a962;
        --error-red: #a63d2f;
        --text-muted: #6b7280;

        /* Typography */
        --font-display: 'Libre Baskerville', Georgia, serif;
        --font-body: 'Crimson Pro', 'Times New Roman', serif;
        --font-ui: 'Cormorant Garamond', serif;

        /* Type Scale */
        --text-hero: clamp(3rem, 8vw, 5.5rem);
        --text-h1: clamp(2rem, 4vw, 3rem);
        --text-h2: clamp(1.5rem, 3vw, 2rem);
        --text-body: clamp(1rem, 1.5vw, 1.125rem);
        --text-small: 0.875rem;

        /* Spacing */
        --space-xs: 0.5rem;
        --space-sm: 1rem;
        --space-md: 1.5rem;
        --space-lg: 2rem;
        --space-xl: 3rem;

        /* Shadows */
        --shadow-card: 0 2px 8px rgba(26,35,50,0.08);
        --shadow-elevated: 0 4px 16px rgba(26,35,50,0.12);
    }

    * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
    }
```

**Step 3: Verify fonts load**

Run: `npm start`
Open: `http://localhost:3456`
Expected: Page loads (may look broken - that's fine for now)

**Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add design tokens and Google Fonts for RateMY Dutch"
```

---

## Task 2: Update Page Title & Body Styles

**Files:**
- Modify: `index.html:4` (title)
- Modify: `index.html` (body styles in CSS)

**Step 1: Change page title**

Find:
```html
<title>Inburgeringsexamen A2 Practice - Schrijven & Lezen</title>
```

Replace with:
```html
<title>RateMY Dutch - Practice Your Dutch</title>
```

**Step 2: Replace body styles**

Find the existing body rule and replace:

```css
body {
    font-family: var(--font-body);
    font-size: var(--text-body);
    line-height: 1.7;
    background: var(--cream);
    color: var(--navy-deep);
    min-height: 100vh;
}
```

**Step 3: Verify**

Run: `npm start` (if not running)
Expected: Background is now cream, text is navy, serif fonts visible

**Step 4: Commit**

```bash
git add index.html
git commit -m "feat: update title to RateMY Dutch, apply cream background"
```

---

## Task 3: Create Hero Section

**Files:**
- Modify: `index.html` (add hero HTML after body tag, add hero CSS)

**Step 1: Add hero HTML structure**

Find the opening `<body>` and the start of `<div class="container">`. Insert hero BEFORE container:

```html
<body>
    <!-- Hero Section -->
    <section class="hero" id="hero">
        <div class="hero-content">
            <h1 class="hero-title">RateMY Dutch</h1>
            <p class="hero-tagline">Master your Dutch. Prepare with precision.</p>
            <button class="btn-primary hero-cta" onclick="document.getElementById('main-content').scrollIntoView({behavior: 'smooth'})">
                Begin Practice
            </button>
        </div>
        <div class="scroll-indicator">
            <span>↓</span>
        </div>
    </section>

    <!-- Main Content -->
    <div id="main-content" class="container">
```

**Step 2: Add hero CSS**

Add after the body styles:

```css
/* Hero Section */
.hero {
    min-height: 100vh;
    background: var(--navy-deep);
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    padding: var(--space-lg);
    position: relative;
}

.hero-content {
    animation: fadeUp 0.8s ease-out;
}

.hero-title {
    font-family: var(--font-display);
    font-size: var(--text-hero);
    color: var(--cream);
    letter-spacing: -0.02em;
    margin-bottom: var(--space-md);
    animation: fadeUp 0.6s ease-out;
}

.hero-tagline {
    font-family: var(--font-body);
    font-size: var(--text-h2);
    color: var(--cream);
    opacity: 0.85;
    margin-bottom: var(--space-xl);
    animation: fadeUp 0.6s ease-out 0.2s both;
}

.hero-cta {
    animation: fadeUp 0.6s ease-out 0.4s both;
}

.scroll-indicator {
    position: absolute;
    bottom: var(--space-lg);
    color: var(--cream);
    opacity: 0.6;
    font-size: 1.5rem;
    animation: bounce 2s infinite;
}

@keyframes fadeUp {
    from {
        opacity: 0;
        transform: translateY(20px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

@keyframes bounce {
    0%, 20%, 50%, 80%, 100% {
        transform: translateY(0);
    }
    40% {
        transform: translateY(-10px);
    }
    60% {
        transform: translateY(-5px);
    }
}
```

**Step 3: Add primary button styles**

```css
/* Buttons */
.btn-primary {
    background: var(--cream);
    color: var(--navy-deep);
    padding: 0.875rem 2rem;
    border: none;
    font-family: var(--font-ui);
    font-size: var(--text-small);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    cursor: pointer;
    transition: all 0.3s ease;
}

.btn-primary:hover {
    background: var(--warm-white);
    box-shadow: var(--shadow-elevated);
    transform: translateY(-2px);
}

.btn-secondary {
    background: transparent;
    color: var(--navy-deep);
    padding: 0.875rem 2rem;
    border: 1px solid var(--navy-deep);
    font-family: var(--font-ui);
    font-size: var(--text-small);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    cursor: pointer;
    transition: all 0.3s ease;
}

.btn-secondary:hover {
    background: var(--navy-deep);
    color: var(--cream);
}
```

**Step 4: Verify**

Refresh browser
Expected: Dark navy hero with "RateMY Dutch" in elegant serif, cream button, scroll indicator bouncing

**Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add dramatic hero section with animations"
```

---

## Task 4: Restyle Header Section

**Files:**
- Modify: `index.html` (header HTML and CSS)

**Step 1: Update header HTML**

Find the existing `<header>` element and replace entirely:

```html
<header class="app-header">
    <div class="header-brand">
        <span class="header-logo">RateMY Dutch</span>
    </div>
</header>
```

**Step 2: Replace header CSS**

Remove old header styles and add:

```css
/* App Header */
.app-header {
    background: var(--navy-deep);
    padding: var(--space-sm) var(--space-lg);
    position: sticky;
    top: 0;
    z-index: 100;
}

.header-brand {
    max-width: 1200px;
    margin: 0 auto;
}

.header-logo {
    font-family: var(--font-display);
    font-size: 1.25rem;
    color: var(--cream);
    letter-spacing: -0.01em;
}
```

**Step 3: Verify**

Refresh browser, scroll past hero
Expected: Sticky navy header with "RateMY Dutch" branding

**Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add sticky navy header with branding"
```

---

## Task 5: Restyle Mode Selector (Schrijven/Lezen Tabs)

**Files:**
- Modify: `index.html` (mode selector CSS)

**Step 1: Replace mode selector CSS**

Find `.mode-selector` and `.mode-btn` styles. Replace with:

```css
/* Mode Tabs */
.mode-selector {
    display: flex;
    gap: var(--space-lg);
    justify-content: center;
    margin-bottom: var(--space-xl);
    padding: var(--space-md) 0;
    border-bottom: 1px solid var(--cream-dark);
}

.mode-btn {
    background: none;
    border: none;
    padding: var(--space-sm) 0;
    font-family: var(--font-ui);
    font-size: 1rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
    cursor: pointer;
    position: relative;
    transition: color 0.3s ease;
}

.mode-btn::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0;
    width: 100%;
    height: 2px;
    background: var(--navy-deep);
    transform: scaleX(0);
    transition: transform 0.3s ease;
}

.mode-btn:hover {
    color: var(--navy-deep);
}

.mode-btn.active {
    color: var(--navy-deep);
    font-weight: 600;
}

.mode-btn.active::after {
    transform: scaleX(1);
}

/* Remove old gradient classes */
.mode-btn.schrijven,
.mode-btn.lezen {
    background: none;
}
```

**Step 2: Verify**

Refresh browser
Expected: Clean underlined tabs instead of colorful pills, active tab has navy underline

**Step 3: Commit**

```bash
git add index.html
git commit -m "feat: restyle mode tabs to editorial underline style"
```

---

## Task 6: Restyle Sidebar

**Files:**
- Modify: `index.html` (sidebar CSS)

**Step 1: Replace sidebar CSS**

Find `.exam-sidebar` and related styles. Replace with:

```css
/* Sidebar */
.exam-sidebar {
    background: var(--warm-white);
    border-radius: 0;
    padding: var(--space-lg);
    box-shadow: var(--shadow-card);
    border-left: 3px solid var(--navy-deep);
    height: fit-content;
    position: sticky;
    top: 80px;
}

.exam-section {
    margin-bottom: var(--space-md);
}

.exam-section-title {
    font-family: var(--font-ui);
    font-size: var(--text-small);
    font-weight: 500;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--navy-deep);
    padding: var(--space-sm);
    background: none;
    border-radius: 0;
    margin-bottom: var(--space-xs);
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--cream-dark);
    transition: all 0.2s ease;
}

.exam-section-title:hover {
    background: var(--cream);
}

/* Remove old gradient classes from section titles */
.exam-section-title.original,
.exam-section-title.e2,
.exam-section-title.e3,
.exam-section-title.e4,
.exam-section-title.d1,
.exam-section-title.d2,
.exam-section-title.d3 {
    background: none;
    color: var(--navy-deep);
}

.exercise-list {
    list-style: none;
    padding: 0;
    margin: 0;
}

.exercise-item {
    font-family: var(--font-body);
    font-size: var(--text-small);
    padding: var(--space-xs) var(--space-sm);
    cursor: pointer;
    color: var(--text-muted);
    border-left: 2px solid transparent;
    transition: all 0.2s ease;
    margin-left: var(--space-sm);
}

.exercise-item:hover {
    color: var(--navy-deep);
    background: var(--cream);
    border-left-color: var(--navy-mid);
}

.exercise-item.active {
    color: var(--navy-deep);
    background: var(--cream);
    border-left-color: var(--navy-deep);
    font-weight: 500;
}

.exercise-item.completed {
    color: var(--text-muted);
}

.exercise-item.completed::after {
    content: ' ✓';
    color: var(--dutch-orange);
}
```

**Step 2: Verify**

Refresh browser
Expected: Clean cream sidebar with navy border, minimal text links for exercises

**Step 3: Commit**

```bash
git add index.html
git commit -m "feat: restyle sidebar to editorial minimal design"
```

---

## Task 7: Restyle Main Content Area & Exercise Cards

**Files:**
- Modify: `index.html` (main content and card CSS)

**Step 1: Update container and main content styles**

```css
/* Container */
.container {
    max-width: 1200px;
    margin: 0 auto;
    padding: var(--space-lg);
}

/* Exam Layout */
.exam-layout {
    display: grid;
    grid-template-columns: 260px 1fr;
    gap: var(--space-xl);
}

@media (max-width: 900px) {
    .exam-layout {
        grid-template-columns: 1fr;
    }
}

/* Exercise Card */
.exercise-card,
.exam-content {
    background: var(--warm-white);
    padding: var(--space-xl);
    box-shadow: var(--shadow-card);
    border: 1px solid rgba(26,35,50,0.06);
}

.exercise-title {
    font-family: var(--font-display);
    font-size: var(--text-h2);
    color: var(--navy-deep);
    margin-bottom: var(--space-md);
    letter-spacing: -0.01em;
}

.exercise-instructions {
    font-family: var(--font-body);
    font-size: var(--text-body);
    color: var(--navy-mid);
    line-height: 1.7;
    margin-bottom: var(--space-lg);
}

.exercise-prompt {
    font-family: var(--font-body);
    font-size: var(--text-body);
    color: var(--navy-deep);
    line-height: 1.8;
    padding: var(--space-md);
    background: var(--cream);
    border-left: 3px solid var(--soft-gold);
    margin-bottom: var(--space-lg);
}
```

**Step 2: Verify**

Refresh browser
Expected: Clean white cards on cream background, elegant typography

**Step 3: Commit**

```bash
git add index.html
git commit -m "feat: restyle exercise cards with premium typography"
```

---

## Task 8: Create Writing Area (Legal Pad Style)

**Files:**
- Modify: `index.html` (textarea CSS)

**Step 1: Replace textarea styles**

```css
/* Writing Area - Legal Pad Style */
textarea,
.writing-area {
    width: 100%;
    min-height: 250px;
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
    font-family: var(--font-body);
    font-size: 1.1rem;
    line-height: 1.8rem;
    padding: var(--space-md);
    resize: vertical;
    transition: box-shadow 0.3s ease;
}

textarea:focus,
.writing-area:focus {
    outline: none;
    box-shadow:
        inset 0 1px 3px rgba(26,35,50,0.08),
        0 0 0 3px rgba(201,169,98,0.25);
}

textarea::placeholder {
    color: var(--text-muted);
    font-style: italic;
}
```

**Step 2: Verify**

Refresh browser, go to Schrijven mode
Expected: Textarea with subtle ruled lines like a legal pad, warm focus glow

**Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add legal pad style writing area with ruled lines"
```

---

## Task 9: Restyle AI Grading Feedback Display

**Files:**
- Modify: `index.html` (grading display CSS)

**Step 1: Add grading card styles**

```css
/* AI Grading Display */
.grading-result,
.ai-feedback {
    background: var(--warm-white);
    border: 1px solid rgba(26,35,50,0.06);
    margin-top: var(--space-lg);
}

.grading-header {
    background: var(--navy-deep);
    color: var(--cream);
    padding: var(--space-md) var(--space-lg);
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.grading-title {
    font-family: var(--font-ui);
    font-size: var(--text-small);
    letter-spacing: 0.15em;
    text-transform: uppercase;
}

.grading-score-total {
    font-family: var(--font-display);
    font-size: var(--text-h2);
    color: var(--soft-gold);
}

.grading-body {
    padding: var(--space-lg);
}

/* Score Bars */
.score-item {
    display: flex;
    align-items: center;
    margin-bottom: var(--space-sm);
    gap: var(--space-md);
}

.score-label {
    font-family: var(--font-ui);
    font-size: var(--text-small);
    color: var(--navy-mid);
    width: 100px;
    flex-shrink: 0;
}

.score-bar {
    flex: 1;
    height: 4px;
    background: var(--cream-dark);
    position: relative;
}

.score-bar-fill {
    height: 100%;
    background: var(--soft-gold);
    transition: width 0.6s ease-out;
}

.score-value {
    font-family: var(--font-ui);
    font-size: var(--text-small);
    color: var(--navy-deep);
    width: 40px;
    text-align: right;
}

/* Feedback Text */
.feedback-section {
    margin-top: var(--space-lg);
    padding-top: var(--space-lg);
    border-top: 1px solid var(--cream-dark);
}

.feedback-title {
    font-family: var(--font-display);
    font-size: 1rem;
    color: var(--navy-deep);
    margin-bottom: var(--space-sm);
}

.feedback-text {
    font-family: var(--font-body);
    font-size: var(--text-body);
    color: var(--navy-mid);
    line-height: 1.7;
}

.feedback-text strong {
    color: var(--navy-deep);
}

.feedback-text .correction {
    background: var(--cream);
    padding: 0.1em 0.3em;
}
```

**Step 2: Verify**

Run a grading test (requires PERPLEXITY_API_KEY)
Expected: Navy header bar, gold score bars, clean typography

**Step 3: Commit**

```bash
git add index.html
git commit -m "feat: restyle AI grading display with premium score bars"
```

---

## Task 10: Restyle Reading (Lezen) Multiple Choice

**Files:**
- Modify: `index.html` (multiple choice CSS)

**Step 1: Add multiple choice styles**

```css
/* Multiple Choice */
.answer-options {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    margin: var(--space-lg) 0;
}

.answer-option {
    display: flex;
    align-items: flex-start;
    gap: var(--space-sm);
    padding: var(--space-md);
    background: var(--cream);
    border: 1px solid var(--cream-dark);
    cursor: pointer;
    transition: all 0.2s ease;
}

.answer-option:hover {
    background: var(--warm-white);
    border-color: var(--navy-mid);
}

.answer-option.selected {
    background: var(--warm-white);
    border-color: var(--navy-deep);
}

.answer-option.correct {
    background: rgba(212,101,42,0.08);
    border-color: var(--dutch-orange);
}

.answer-option.incorrect {
    background: rgba(166,61,47,0.08);
    border-color: var(--error-red);
}

.option-letter {
    font-family: var(--font-ui);
    font-size: var(--text-small);
    font-weight: 600;
    color: var(--navy-deep);
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--navy-mid);
    flex-shrink: 0;
}

.option-text {
    font-family: var(--font-body);
    font-size: var(--text-body);
    color: var(--navy-deep);
    line-height: 1.6;
}
```

**Step 2: Verify**

Switch to Lezen mode
Expected: Clean multiple choice with square letter indicators

**Step 3: Commit**

```bash
git add index.html
git commit -m "feat: restyle reading multiple choice answers"
```

---

## Task 11: Add Paper Texture & Final Polish

**Files:**
- Modify: `index.html` (add texture, polish animations)

**Step 1: Add subtle paper texture to body**

Update body styles:

```css
body {
    font-family: var(--font-body);
    font-size: var(--text-body);
    line-height: 1.7;
    background: var(--cream);
    /* Subtle paper texture */
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%' height='100%' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E");
    color: var(--navy-deep);
    min-height: 100vh;
}
```

**Step 2: Add card entrance animations**

```css
/* Card Animations */
.exercise-card,
.exam-content {
    animation: cardFadeIn 0.4s ease-out;
}

@keyframes cardFadeIn {
    from {
        opacity: 0;
        transform: translateY(10px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}
```

**Step 3: Add loading state styles**

```css
/* Loading State */
.loading {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    color: var(--navy-mid);
    font-family: var(--font-body);
    font-style: italic;
}

.loading-dots {
    display: flex;
    gap: 4px;
}

.loading-dots span {
    width: 6px;
    height: 6px;
    background: var(--navy-mid);
    border-radius: 50%;
    animation: dotPulse 1.4s infinite ease-in-out;
}

.loading-dots span:nth-child(2) {
    animation-delay: 0.2s;
}

.loading-dots span:nth-child(3) {
    animation-delay: 0.4s;
}

@keyframes dotPulse {
    0%, 80%, 100% {
        transform: scale(0.6);
        opacity: 0.5;
    }
    40% {
        transform: scale(1);
        opacity: 1;
    }
}
```

**Step 4: Verify**

Refresh browser
Expected: Subtle paper texture visible, smooth card animations

**Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add paper texture and polish animations"
```

---

## Task 12: Remove Old Gradient Styles & Cleanup

**Files:**
- Modify: `index.html` (remove old CSS)

**Step 1: Search and remove old gradient styles**

Remove any remaining references to:
- `linear-gradient(135deg, #667eea 0%, #764ba2 100%)` (purple gradients)
- `linear-gradient(135deg, #f093fb 0%, #f5576c 100%)` (pink gradients)
- `linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)` (blue gradients)
- Old `.exam-info`, `.mode-btn.schrijven`, `.mode-btn.lezen` gradient classes

**Step 2: Remove old exam-info section from HTML**

Find and update or remove the `.exam-info` element in the header (the one mentioning "A2 level").

**Step 3: Verify**

Full browser test - navigate through:
- Hero section
- Schrijven mode (write something, test grading if API key available)
- Lezen mode (test multiple choice)
Expected: Cohesive navy/cream design throughout, no purple remnants

**Step 4: Commit**

```bash
git add index.html
git commit -m "chore: remove old gradient styles and cleanup"
```

---

## Task 13: Responsive Adjustments

**Files:**
- Modify: `index.html` (media queries)

**Step 1: Update/add media queries**

```css
/* Responsive */
@media (max-width: 900px) {
    .exam-layout {
        grid-template-columns: 1fr;
    }

    .exam-sidebar {
        position: relative;
        top: 0;
        border-left: none;
        border-top: 3px solid var(--navy-deep);
    }

    .hero-title {
        font-size: clamp(2.5rem, 10vw, 4rem);
    }
}

@media (max-width: 600px) {
    .container {
        padding: var(--space-md);
    }

    .mode-selector {
        flex-direction: column;
        align-items: stretch;
        gap: 0;
    }

    .mode-btn {
        padding: var(--space-md);
        text-align: center;
        border-bottom: 1px solid var(--cream-dark);
    }

    .mode-btn::after {
        display: none;
    }

    .mode-btn.active {
        background: var(--cream);
    }

    .exercise-card,
    .exam-content {
        padding: var(--space-md);
    }
}
```

**Step 2: Verify on mobile**

Use browser dev tools to test at 375px and 768px widths
Expected: Layout adapts gracefully, sidebar stacks on mobile

**Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add responsive styles for mobile and tablet"
```

---

## Task 14: Final Review & Push

**Step 1: Full visual review**

Test all flows:
- [ ] Hero loads with animations
- [ ] Scroll to content works
- [ ] Mode tabs switch correctly
- [ ] Sidebar navigation works
- [ ] Writing area has ruled lines
- [ ] Grading display looks correct (if API available)
- [ ] Reading multiple choice works
- [ ] Mobile responsive works

**Step 2: Push to remote**

```bash
git push -u origin feature/ratemydutch-redesign
```

**Step 3: Create PR (optional)**

```bash
gh pr create --title "Redesign: RateMY Dutch premium editorial theme" --body "$(cat <<'EOF'
## Summary
- Rebranded to "RateMY Dutch"
- Premium navy/cream color palette
- Elegant serif typography (Libre Baskerville, Crimson Pro)
- Dramatic hero section with animations
- Legal pad style writing areas
- Editorial tab and sidebar design
- Paper texture backgrounds
- Responsive mobile support

## Design Document
See `docs/plans/2026-01-15-ratemydutch-redesign.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

**Plan complete and saved to `docs/plans/2026-01-15-ratemydutch-implementation.md`.**

Two execution options:

1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

2. **Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
