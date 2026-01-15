# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A2 Dutch Inburgeringsexamen (civic integration exam) practice application with AI-powered grammar feedback. The app provides two practice modes:
- **Schrijven (Writing)**: Practice writing exercises with AI grading using the official DUO rubric
- **Lezen (Reading)**: Multiple-choice reading comprehension practice

## Commands

```bash
# Install dependencies
npm install

# Run development server (default port 3456)
npm start

# Run with Perplexity API key for AI grading
PERPLEXITY_API_KEY=your_key npm start
```

The app runs at `http://localhost:3456` by default. Port can be overridden via `PORT` environment variable.

## Architecture

**Single-page application with Express backend:**

```
server.js          # Express server, API endpoint for AI grading
index.html         # Main app served from root (contains all HTML/CSS/JS)
public/index.html  # Static version (same content)
```

### Backend (`server.js`)
- Express server serving static files and the main HTML
- `/api/grade-writing` - POST endpoint for AI-powered writing assessment
- `/api/check-grammar` - Legacy endpoint (redirects to grade-writing)
- Uses Perplexity API (`sonar` model) for grading
- Contains embedded `OFFICIAL_RUBRIC` constant with DUO grading criteria

### Frontend (embedded in `index.html`)
- All JavaScript is inline in `<script>` tags
- State management via module-level variables:
  - `currentMode` - 'schrijven' or 'lezen'
  - `currentSection`, `currentExerciseIndex` - navigation state
  - `examSections` - contains all exercises (original, e2, e3, e4, d1, d2, d3)
  - `completedExercises` - tracks user progress per section
  - `taskScores` - stores scores for writing tasks

### Key Frontend Functions
- `gradeWithAI()` - calls backend API for AI grading
- `displayAIGrading()` - renders AI feedback with rubric scores
- `showModelAnswer()` - displays reference answer with self-assessment rubric
- `selectExercise()`, `showCurrentExercise()` - navigation
- `checkAnswer()` - validates reading comprehension answers

## DUO Grading Rubric

Writing is graded on 5 categories (max 10 points total):
1. **Execution** (0-3 pts) - If 0, all other scores must be 0
2. **Grammar** (0-2 pts)
3. **Spelling** (0-2 pts)
4. **Clearness** (0-1 pt)
5. **Vocabulary** (0-2 pts)

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PERPLEXITY_API_KEY` | For AI grading | Perplexity API key |
| `PORT` | No | Server port (default: 3456) |
