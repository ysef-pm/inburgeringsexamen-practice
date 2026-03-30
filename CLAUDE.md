# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A2 Dutch Inburgeringsexamen (civic integration exam) practice application with AI-powered feedback. The app covers all 5 exam sections:
- **Schrijven (Writing)**: Practice writing exercises with AI grading using the official DUO rubric
- **Lezen (Reading)**: Multiple-choice reading comprehension practice
- **Spreken (Speaking)**: Record speech, transcribe with Whisper, grade with AI on 5 rubric categories
- **Luisteren (Listening)**: Audio playback (one-time only) with multiple-choice questions
- **KNM (Knowledge of Dutch Society)**: Scenario-based multiple-choice across 6 topic categories

## Commands

```bash
# Install dependencies
npm install

# Run development server (default port 3456)
npm start

# Run with API keys for AI grading + speech transcription
PERPLEXITY_API_KEY=your_key OPENAI_API_KEY=your_key npm start
```

The app runs at `http://localhost:3456` by default. Port can be overridden via `PORT` environment variable.

## Architecture

**Single-page application with Express backend and modular JS:**

```
server.js                    # Express server, API endpoints
index.html                   # Main app shell (HTML/CSS + inline JS for schrijven/lezen)
public/
  js/
    shared.js                # Shared utilities (CountdownTimer, AudioRecorder, etc.)
    spreken.js               # Speaking module (record + transcribe + grade)
    luisteren.js             # Listening module (audio playback + MCQ)
    knm.js                   # KNM module (scenario-based MCQ)
  data/
    spreken-exercises.json   # Speaking exercise prompts
    luisteren-exercises.json # Listening questions + transcripts
    knm-exercises.json       # KNM scenarios + answers
  audio/luisteren/           # Audio files for listening exercises
  images/spreken/            # Images for speaking prompts
  images/knm/                # Images for KNM scenarios
```

### Backend (`server.js`)
- Express server serving static files and the main HTML
- `/api/grade-writing` - POST endpoint for AI-powered writing assessment
- `/api/check-grammar` - Legacy endpoint (redirects to grade-writing)
- `/api/transcribe-speech` - POST endpoint, sends audio to OpenAI Whisper for Dutch transcription
- `/api/grade-speaking` - POST endpoint, grades transcribed speech on 5 categories via Perplexity
- Uses Perplexity API (`sonar` model) for grading, OpenAI API for Whisper

### Frontend
- Schrijven/Lezen: inline JS in `index.html` (legacy)
- Spreken/Luisteren/KNM: ES modules in `public/js/` loaded via `<script type="module">`
- Mode switching via `startMode()` — extended by module script for new modes
- Shared utilities in `public/js/shared.js`: CountdownTimer, AudioRecorder, OneTimeAudioPlayer, ProgressTracker

## DUO Grading Rubrics

### Writing (Schrijven) — max 10 points
1. **Execution** (0-3 pts) - If 0, all other scores must be 0
2. **Grammar** (0-2 pts)
3. **Spelling** (0-2 pts)
4. **Clearness** (0-1 pt)
5. **Vocabulary** (0-2 pts)

### Speaking (Spreken) — max 10 points
1. **Adequacy** (0-2 pts)
2. **Vocabulary** (0-2 pts)
3. **Grammar** (0-2 pts)
4. **Fluency** (0-2 pts)
5. **Pronunciation** (0-2 pts)

### Listening (Luisteren) — 25 MCQ, pass: 18-19/25
### KNM — 40 MCQ across 6 categories, pass: 26/40

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PERPLEXITY_API_KEY` | For AI grading | Perplexity API key |
| `OPENAI_API_KEY` | For speaking | OpenAI API key for Whisper transcription |
| `PORT` | No | Server port (default: 3456) |
