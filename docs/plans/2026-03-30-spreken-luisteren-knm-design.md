# Design: Spreken, Luisteren & KNM Exam Modules

**Date:** 2026-03-30
**Branch:** feature/ratemydutch-redesign

## Overview

Add three new exam practice modules to the RateMyDutch app: Spreken (Speaking), Luisteren (Listening), and KNM (Knowledge of Dutch Society). This brings the app to full coverage of all 5 inburgeringsexamen sections.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Architecture | Modular JS files per mode | Current monolith won't scale with 3 more complex modes |
| Speech-to-text | OpenAI Whisper API | Best Dutch accuracy, simple API, ~$0.006/min |
| Audio content | Start with DUO official practice exams | Authentic exam experience; supplement with generated content later |
| KNM spoken questions | Simplified to MCQ | All 40 KNM questions are multiple-choice for consistency |
| Speaking grading | AI grading via Perplexity (same as writing) | Instant feedback vs waiting for human assessors |

## Navigation

5 mode tabs in sticky nav bar:

| Tab | Mode Key | Type | Status |
|-----|----------|------|--------|
| Schrijven | `schrijven` | Writing + AI grading | Existing |
| Lezen | `lezen` | Reading MCQ | Existing |
| Spreken | `spreken` | Speech recording + AI grading | New |
| Luisteren | `luisteren` | Audio playback + MCQ | New |
| KNM | `knm` | Scenario-based MCQ | New |

## File Structure

```
server.js                    # Add /api/transcribe-speech, /api/grade-speaking
index.html                   # Shared shell: hero, nav, content container
public/
  js/
    schrijven.js             # Extract existing writing logic
    lezen.js                 # Extract existing reading logic
    spreken.js               # NEW: speech recording + grading
    luisteren.js             # NEW: audio playback + MCQ
    knm.js                   # NEW: scenario MCQ
    shared.js                # Timer, progress tracking, audio recorder
  audio/
    luisteren/               # Listening exam audio files
  images/
    spreken/                 # Speaking prompt images
    knm/                     # KNM scenario images
  data/
    spreken-exercises.json   # Speaking prompts + rubric
    luisteren-exercises.json # Listening questions + audio refs
    knm-exercises.json       # KNM scenarios + answers
```

## Spreken (Speaking) Module

### Real Exam Format
- 35 minutes, 4 parts, ~16 questions
- Graded on: adequacy, vocabulary, grammar, fluency, pronunciation
- Pass: 9/12 correct

### Practice App Flow
1. User sees prompt on screen (text + optional images)
2. Preparation countdown (25 seconds to read)
3. Recording starts automatically with visible countdown (20s or 60s)
4. Red recording indicator + waveform visualization
5. Recording stops automatically when time expires (or user can stop early)
6. Audio sent to server -> Whisper API transcription -> AI grading
7. Results shown: transcription, scores per rubric category, feedback

### 4 Parts
- Part 1: Short Q&A prompts (20-30s responses)
- Part 2: Describe 1 image (60s)
- Part 3: Compare 2 images (60s)
- Part 4: Tell a story from 3 images (60s)

### Backend Endpoints
- `POST /api/transcribe-speech` — sends audio blob to OpenAI Whisper, returns transcription
- `POST /api/grade-speaking` — sends transcription + prompt to Perplexity, grades on 5 categories
- Requires `OPENAI_API_KEY` env var

## Luisteren (Listening) Module

### Real Exam Format
- 45 minutes, 25 MCQ questions
- Audio/video fragments play once only, no replay
- 25 seconds to read question before audio plays
- Pass: 18-19/25 correct

### Practice App Flow
1. Question + answer options appear on screen (25 seconds reading time)
2. Audio fragment plays once — no pause, no replay, no scrubber
3. After audio finishes, user selects from 3 multiple-choice options
4. Immediate feedback: correct/incorrect + explanation

### Audio Player UI
- Custom player (not native `<audio>` controls) — hides scrubber/seek
- Visual progress bar that fills as audio plays (no interaction)
- Speaker icon with animated waveform while playing
- "Playing..." indicator, then switches to "Select your answer" when done

### Exercise Data Structure
```json
{
  "exam": "Luisteren Oefenexamen 1",
  "questions": [
    {
      "id": 1,
      "questionText": "Waar gaat de man naartoe?",
      "audioFile": "luisteren/exam1/q1.mp3",
      "options": ["Naar de dokter", "Naar de supermarkt", "Naar het station"],
      "correctAnswer": 1,
      "explanation": "De man zegt: 'Ik ga boodschappen doen.'"
    }
  ]
}
```

## KNM Module

### Real Exam Format
- 45 minutes, 40 MCQ questions
- Video scenarios about everyday Dutch situations
- 6 topic areas
- Pass: 26/40 correct (grade 6/10)

### Practice App Flow
1. Show scenario description + image
2. Question appears below the scenario
3. User picks from 3-4 multiple-choice options
4. Immediate feedback with cultural context explanation

### Topic Categories
- Werk & Inkomen (Work & Income)
- Wonen (Housing)
- Gezondheid (Health)
- Onderwijs (Education)
- Overheid & Recht (Government & Law)
- Normen & Waarden (Norms & Values)

### Exercise Data Structure
```json
{
  "exam": "KNM Oefenexamen 1",
  "questions": [
    {
      "id": 1,
      "category": "Gezondheid",
      "scenario": "Je kind is ziek en heeft 39 graden koorts...",
      "image": "knm/health-doctor.jpg",
      "questionText": "Wat doe je?",
      "options": ["Je belt 112", "Je belt de huisarts", "Je gaat naar de apotheek"],
      "correctAnswer": 1,
      "explanation": "Bij koorts bel je eerst de huisarts. 112 is alleen voor levensbedreigende situaties."
    }
  ]
}
```

## Shared Utilities (shared.js)

- **CountdownTimer** — configurable duration, visual ring/bar, callbacks for tick/complete
- **AudioRecorder** — wraps MediaRecorder API, returns blob, waveform visualization
- **AudioPlayer** — one-time-play restriction, progress bar, no seek
- **ProgressTracker** — tracks completed exercises per mode, persists to localStorage
- **ScoreDisplay** — reusable component for showing rubric scores (used by schrijven and spreken)

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PERPLEXITY_API_KEY` | For AI grading | Perplexity API key (existing) |
| `OPENAI_API_KEY` | For speaking | OpenAI API key for Whisper transcription |
| `PORT` | No | Server port (default: 3456) |
