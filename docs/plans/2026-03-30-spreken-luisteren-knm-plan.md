# Spreken, Luisteren & KNM Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Speaking, Listening, and KNM exam practice modules to the RateMyDutch app, modularizing the codebase in the process.

**Architecture:** Modular JS files per exam mode. Shared utilities in `shared.js`. Exercise data in JSON files under `public/data/`. New API endpoints in `server.js` for speech transcription and grading. The app remains a single-page app with mode switching.

**Tech Stack:** Express, vanilla JS (ES modules via `<script type="module">`), MediaRecorder API, OpenAI Whisper API, Perplexity API

**Design doc:** `docs/plans/2026-03-30-spreken-luisteren-knm-design.md`

---

### Task 1: Create Directory Structure & Shared Utilities

**Files:**
- Create: `public/js/shared.js`
- Create: `public/data/` (directory)
- Create: `public/audio/luisteren/` (directory)
- Create: `public/images/spreken/` (directory)
- Create: `public/images/knm/` (directory)

**Step 1: Create directories**

```bash
mkdir -p public/js public/data public/audio/luisteren public/images/spreken public/images/knm
```

**Step 2: Create `public/js/shared.js` with shared utilities**

Write `public/js/shared.js` with these exports:

```javascript
// ===== Countdown Timer =====
export class CountdownTimer {
    constructor(container, durationSeconds, { onTick, onComplete, label } = {}) {
        this.container = container;
        this.duration = durationSeconds;
        this.remaining = durationSeconds;
        this.onTick = onTick;
        this.onComplete = onComplete;
        this.label = label || '';
        this.interval = null;
        this.render();
    }

    render() {
        const pct = (this.remaining / this.duration) * 100;
        const mins = Math.floor(this.remaining / 60);
        const secs = this.remaining % 60;
        this.container.innerHTML = `
            <div class="countdown-timer">
                <div class="countdown-label">${this.label}</div>
                <div class="countdown-bar">
                    <div class="countdown-fill" style="width: ${pct}%; background: ${pct < 20 ? 'var(--error-red)' : 'var(--dutch-orange)'}"></div>
                </div>
                <div class="countdown-text">${mins}:${secs.toString().padStart(2, '0')}</div>
            </div>
        `;
    }

    start() {
        this.interval = setInterval(() => {
            this.remaining--;
            this.render();
            if (this.onTick) this.onTick(this.remaining);
            if (this.remaining <= 0) {
                this.stop();
                if (this.onComplete) this.onComplete();
            }
        }, 1000);
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    reset(newDuration) {
        this.stop();
        this.duration = newDuration || this.duration;
        this.remaining = this.duration;
        this.render();
    }
}

// ===== Audio Recorder =====
export class AudioRecorder {
    constructor(container) {
        this.container = container;
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.stream = null;
        this.analyser = null;
        this.animFrame = null;
    }

    async requestPermission() {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        return true;
    }

    startRecording() {
        if (!this.stream) throw new Error('Call requestPermission() first');
        this.audioChunks = [];
        this.mediaRecorder = new MediaRecorder(this.stream, { mimeType: 'audio/webm' });
        this.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) this.audioChunks.push(e.data);
        };
        this.mediaRecorder.start();

        // Waveform visualization
        const audioCtx = new AudioContext();
        const source = audioCtx.createMediaStreamSource(this.stream);
        this.analyser = audioCtx.createAnalyser();
        this.analyser.fftSize = 256;
        source.connect(this.analyser);
        this.drawWaveform();

        this.container.innerHTML = `
            <div class="recorder-active">
                <div class="recording-indicator"></div>
                <span>Opnemen...</span>
                <canvas id="waveform-canvas" width="200" height="40"></canvas>
            </div>
        `;
    }

    drawWaveform() {
        if (!this.analyser) return;
        const canvas = document.getElementById('waveform-canvas');
        if (!canvas) { this.animFrame = requestAnimationFrame(() => this.drawWaveform()); return; }
        const ctx = canvas.getContext('2d');
        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const draw = () => {
            this.animFrame = requestAnimationFrame(draw);
            this.analyser.getByteFrequencyData(dataArray);
            ctx.fillStyle = 'var(--cream)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            const barWidth = (canvas.width / bufferLength) * 2.5;
            let x = 0;
            for (let i = 0; i < bufferLength; i++) {
                const barHeight = (dataArray[i] / 255) * canvas.height;
                ctx.fillStyle = 'var(--dutch-orange)';
                ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
                x += barWidth + 1;
            }
        };
        draw();
    }

    stopRecording() {
        return new Promise((resolve) => {
            if (this.animFrame) cancelAnimationFrame(this.animFrame);
            this.mediaRecorder.onstop = () => {
                const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
                this.container.innerHTML = '<div class="recorder-done">Recording complete</div>';
                resolve(blob);
            };
            this.mediaRecorder.stop();
        });
    }

    cleanup() {
        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
        }
    }
}

// ===== One-Time Audio Player =====
export class OneTimeAudioPlayer {
    constructor(container, audioSrc) {
        this.container = container;
        this.audio = new Audio(audioSrc);
        this.hasPlayed = false;
        this.render();
    }

    render() {
        this.container.innerHTML = `
            <div class="audio-player">
                <div class="audio-icon">&#128266;</div>
                <div class="audio-progress-bar">
                    <div class="audio-progress-fill" id="audio-fill" style="width: 0%"></div>
                </div>
                <div class="audio-status" id="audio-status">Klaar om af te spelen</div>
            </div>
        `;
    }

    play() {
        if (this.hasPlayed) return Promise.resolve();
        this.hasPlayed = true;
        const fill = this.container.querySelector('#audio-fill');
        const status = this.container.querySelector('#audio-status');
        status.textContent = 'Afspelen...';

        this.audio.ontimeupdate = () => {
            const pct = (this.audio.currentTime / this.audio.duration) * 100;
            fill.style.width = `${pct}%`;
        };

        return new Promise((resolve) => {
            this.audio.onended = () => {
                fill.style.width = '100%';
                status.textContent = 'Afgespeeld - kies je antwoord';
                resolve();
            };
            this.audio.play();
        });
    }
}

// ===== Progress Tracker =====
export class ProgressTracker {
    constructor(mode) {
        this.mode = mode;
        this.key = `rmd-progress-${mode}`;
    }

    getCompleted() {
        return JSON.parse(localStorage.getItem(this.key) || '[]');
    }

    markCompleted(exerciseId) {
        const completed = this.getCompleted();
        if (!completed.includes(exerciseId)) {
            completed.push(exerciseId);
            localStorage.setItem(this.key, JSON.stringify(completed));
        }
    }

    isCompleted(exerciseId) {
        return this.getCompleted().includes(exerciseId);
    }

    getCount() {
        return this.getCompleted().length;
    }
}
```

**Step 3: Commit**

```bash
git add public/js/shared.js
git commit -m "feat: add shared utilities (timer, recorder, audio player, progress tracker)"
```

---

### Task 2: Add Server Endpoints for Speech Transcription & Grading

**Files:**
- Modify: `server.js`

**Step 1: Add multer dependency for file uploads**

```bash
npm install multer
```

**Step 2: Add speech transcription endpoint to `server.js`**

Add after the existing require statements at the top of `server.js`:

```javascript
const multer = require('multer');
const fs = require('fs');
const OpenAI = require('openai');

const upload = multer({ dest: 'uploads/' });
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
```

Add `app.use(express.json({ limit: '10mb' }));` — replace the existing `app.use(express.json());` line.

Add before the `const PORT` line:

```javascript
// Speech transcription endpoint (Whisper)
app.post('/api/transcribe-speech', upload.single('audio'), async (req, res) => {
    if (!OPENAI_API_KEY) {
        return res.json({ success: false, error: 'OPENAI_API_KEY not configured.' });
    }
    if (!req.file) {
        return res.json({ success: false, error: 'No audio file received.' });
    }

    try {
        const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(req.file.path),
            model: 'whisper-1',
            language: 'nl',
        });

        // Clean up uploaded file
        fs.unlinkSync(req.file.path);

        res.json({ success: true, transcription: transcription.text });
    } catch (error) {
        console.error('Transcription error:', error);
        if (req.file) fs.unlinkSync(req.file.path);
        res.json({ success: false, error: 'Failed to transcribe audio.' });
    }
});

// Speaking grading endpoint
const SPEAKING_RUBRIC = `
## Official Speaking Grading Rubric for Inburgeringsexamen Spreken (A2)

Grade the candidate's spoken response (transcribed) on these 5 categories:

### 1. ADEQUACY (Taakuitvoering) - Maximum 2 points
- 0: Response does not address the task/question at all
- 1: Response partially addresses the task
- 2: Response fully and appropriately addresses the task

### 2. VOCABULARY (Woordenschat) - Maximum 2 points
- 0: Very limited vocabulary, cannot express basic ideas
- 1: Basic vocabulary, can express simple ideas with limitations
- 2: Adequate vocabulary for A2 level communication

### 3. GRAMMAR (Grammatica) - Maximum 2 points
- 0: Frequent grammar errors that impede understanding
- 1: Some grammar errors but meaning is usually clear
- 2: Grammar is mostly correct for A2 level

### 4. FLUENCY (Vloeiendheid) - Maximum 2 points
- 0: Very hesitant, many long pauses, very fragmented
- 1: Some hesitation but can maintain basic communication
- 2: Reasonably fluent for A2 level

### 5. PRONUNCIATION (Uitspraak) - Maximum 2 points
- 0: Pronunciation makes speech very difficult to understand
- 1: Some pronunciation issues but generally understandable
- 2: Clear pronunciation, easily understood

TOTAL MAXIMUM: 10 points (2+2+2+2+2)
`;

app.post('/api/grade-speaking', async (req, res) => {
    const { transcription, prompt, partType } = req.body;

    if (!transcription || transcription.trim().length === 0) {
        return res.json({ success: false, error: 'No transcription to grade.' });
    }
    if (!PERPLEXITY_API_KEY) {
        return res.json({ success: false, error: 'PERPLEXITY_API_KEY not configured.' });
    }

    try {
        const systemPrompt = `You are an official examiner for the Dutch Inburgeringsexamen A2 speaking test.
Grade the transcribed spoken response using the rubric EXACTLY as specified.

${SPEAKING_RUBRIC}

You MUST respond with ONLY a valid JSON object (no markdown, no extra text):
{
    "scores": {
        "adequacy": { "score": <0-2>, "justification": "<IN ENGLISH>" },
        "vocabulary": { "score": <0-2>, "justification": "<IN ENGLISH>" },
        "grammar": { "score": <0-2>, "justification": "<IN ENGLISH>" },
        "fluency": { "score": <0-2>, "justification": "<IN ENGLISH: Note - since this is transcribed, assess sentence completeness and coherence as proxy>" },
        "pronunciation": { "score": <0-2>, "justification": "<IN ENGLISH: Note - since this is transcribed, assess based on spelling/word patterns suggesting pronunciation issues>" }
    },
    "total": <sum, max 10>,
    "grammarErrors": [{"error": "<Dutch text>", "correction": "<correct>", "explanation": "<IN ENGLISH>"}],
    "strengths": ["<IN ENGLISH>"],
    "improvements": ["<IN ENGLISH>"],
    "overallFeedback": "<IN ENGLISH: 2-3 sentences>"
}

IMPORTANT: This is a TRANSCRIPTION of speech. Assess fluency by sentence completeness/coherence. For pronunciation, note any patterns suggesting mispronunciation but be lenient since Whisper may normalize pronunciation.`;

        const userMessage = `Grade this speaking response:

**TASK:** ${prompt}
**PART TYPE:** ${partType}
**CANDIDATE'S TRANSCRIBED RESPONSE:** ${transcription}

Evaluate and respond with ONLY the JSON object.`;

        const response = await fetch(PERPLEXITY_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'sonar',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage }
                ],
                temperature: 0.2,
                max_tokens: 2000
            })
        });

        if (!response.ok) throw new Error(`API request failed: ${response.status}`);

        const data = await response.json();
        let feedback = data.choices[0].message.content;
        feedback = feedback.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        try {
            const gradingResult = JSON.parse(feedback);
            res.json({ success: true, grading: gradingResult });
        } catch (parseError) {
            res.json({ success: true, rawFeedback: feedback, parseError: true });
        }
    } catch (error) {
        console.error('Speaking grading error:', error);
        res.json({ success: false, error: 'Failed to grade speaking.' });
    }
});
```

**Step 3: Update startup logging to include OPENAI_API_KEY status**

In the `app.listen` callback, after the Perplexity key check, add:

```javascript
if (!OPENAI_API_KEY) {
    console.log('⚠️  Warning: OPENAI_API_KEY not set. Speech transcription will not work.');
    console.log('   Run with: OPENAI_API_KEY=your_key npm start\n');
} else {
    console.log('✅ OpenAI API key configured. Speech transcription enabled.\n');
}
```

**Step 4: Add `uploads/` to `.gitignore`**

```
uploads/
```

**Step 5: Verify server starts**

```bash
npm start
```
Expected: Server starts without errors, shows both API key status messages.

**Step 6: Commit**

```bash
git add server.js package.json package-lock.json .gitignore
git commit -m "feat: add speech transcription and speaking grading API endpoints"
```

---

### Task 3: Create Spreken Exercise Data

**Files:**
- Create: `public/data/spreken-exercises.json`

**Step 1: Write exercise data**

Create `public/data/spreken-exercises.json` with practice exercises structured by the 4 parts of the speaking exam. Include at least 2 exercises per part (8 total) to start. Base content on the DUO practice exam format.

```json
{
    "exam": "Spreken Oefenexamen 1",
    "parts": [
        {
            "partNumber": 1,
            "title": "Vragen beantwoorden",
            "description": "Beantwoord de vraag. Je hebt 20 seconden.",
            "prepTime": 10,
            "responseTime": 20,
            "exercises": [
                {
                    "id": "s1-p1-q1",
                    "prompt": "Iemand vraagt: 'Waar woont u?' Beantwoord de vraag.",
                    "images": [],
                    "tipText": "Zeg waar u woont. Noem de stad of het dorp."
                },
                {
                    "id": "s1-p1-q2",
                    "prompt": "Iemand vraagt: 'Wat doet u in het weekend?' Beantwoord de vraag.",
                    "images": [],
                    "tipText": "Vertel wat u in het weekend doet. Noem minstens twee dingen."
                },
                {
                    "id": "s1-p1-q3",
                    "prompt": "Iemand vraagt: 'Hoe gaat u naar uw werk of school?' Beantwoord de vraag.",
                    "images": [],
                    "tipText": "Vertel hoe u reist. Met de bus, fiets, auto, of te voet?"
                },
                {
                    "id": "s1-p1-q4",
                    "prompt": "Iemand vraagt: 'Heeft u broers of zussen?' Beantwoord de vraag.",
                    "images": [],
                    "tipText": "Vertel over uw familie. Hoeveel broers en zussen heeft u?"
                }
            ]
        },
        {
            "partNumber": 2,
            "title": "Eén afbeelding beschrijven",
            "description": "Bekijk de afbeelding en beschrijf wat je ziet. Je hebt 60 seconden.",
            "prepTime": 25,
            "responseTime": 60,
            "exercises": [
                {
                    "id": "s1-p2-q1",
                    "prompt": "Bekijk de afbeelding. Beschrijf wat je ziet. Wat doen de mensen? Waar zijn ze?",
                    "images": ["spreken/markt.jpg"],
                    "tipText": "Beschrijf de markt. Wat kun je kopen? Hoeveel mensen zijn er? Wat is het weer?"
                },
                {
                    "id": "s1-p2-q2",
                    "prompt": "Bekijk de afbeelding. Beschrijf wat je ziet. Wat gebeurt er?",
                    "images": ["spreken/park.jpg"],
                    "tipText": "Beschrijf het park. Wat doen de mensen? Zijn er kinderen? Dieren?"
                }
            ]
        },
        {
            "partNumber": 3,
            "title": "Twee afbeeldingen vergelijken",
            "description": "Bekijk de twee afbeeldingen. Vergelijk ze. Wat is hetzelfde? Wat is anders? Je hebt 60 seconden.",
            "prepTime": 25,
            "responseTime": 60,
            "exercises": [
                {
                    "id": "s1-p3-q1",
                    "prompt": "Bekijk de twee afbeeldingen. De ene toont een drukke stad, de andere een rustig dorp. Vergelijk de twee plekken. Wat is hetzelfde? Wat is anders?",
                    "images": ["spreken/stad.jpg", "spreken/dorp.jpg"],
                    "tipText": "Vergelijk stad en dorp. Denk aan: mensen, gebouwen, verkeer, natuur."
                },
                {
                    "id": "s1-p3-q2",
                    "prompt": "Bekijk de twee afbeeldingen. De ene toont een zomer dag, de andere een winter dag. Vergelijk de twee. Wat is hetzelfde? Wat is anders?",
                    "images": ["spreken/zomer.jpg", "spreken/winter.jpg"],
                    "tipText": "Vergelijk de seizoenen. Denk aan: weer, kleding, activiteiten."
                }
            ]
        },
        {
            "partNumber": 4,
            "title": "Een verhaal vertellen",
            "description": "Bekijk de drie afbeeldingen. Vertel een verhaal. Wat gebeurt er? Je hebt 60 seconden.",
            "prepTime": 25,
            "responseTime": 60,
            "exercises": [
                {
                    "id": "s1-p4-q1",
                    "prompt": "Bekijk de drie afbeeldingen. Vertel een verhaal over wat er gebeurt. Gebruik de afbeeldingen in de juiste volgorde.",
                    "images": ["spreken/story1-a.jpg", "spreken/story1-b.jpg", "spreken/story1-c.jpg"],
                    "tipText": "Afbeelding 1: Een man kijkt naar zijn fiets. Afbeelding 2: De band is lek. Afbeelding 3: Hij repareert de fiets. Vertel het verhaal."
                },
                {
                    "id": "s1-p4-q2",
                    "prompt": "Bekijk de drie afbeeldingen. Vertel een verhaal over wat er gebeurt.",
                    "images": ["spreken/story2-a.jpg", "spreken/story2-b.jpg", "spreken/story2-c.jpg"],
                    "tipText": "Afbeelding 1: Een vrouw gaat naar de supermarkt. Afbeelding 2: Ze doet boodschappen. Afbeelding 3: Ze kookt thuis. Vertel het verhaal."
                }
            ]
        }
    ]
}
```

Note: The images won't exist yet — the UI should handle missing images gracefully by showing placeholder text from `tipText`.

**Step 2: Commit**

```bash
git add public/data/spreken-exercises.json
git commit -m "feat: add spreken practice exercise data"
```

---

### Task 4: Create Luisteren Exercise Data & Placeholder Audio

**Files:**
- Create: `public/data/luisteren-exercises.json`

**Step 1: Write exercise data**

Create `public/data/luisteren-exercises.json` with practice questions. Since we don't have real audio files yet, we'll use a `transcript` field that can be used to generate TTS audio later. For now the UI will show the transcript as a fallback when audio is missing.

```json
{
    "exams": {
        "exam1": {
            "title": "Luisteren Oefenexamen 1",
            "questions": [
                {
                    "id": "l1-q1",
                    "questionText": "Waar gaat de vrouw naartoe?",
                    "audioFile": "luisteren/exam1/q1.mp3",
                    "transcript": "Man: Ga je mee naar de markt?\nVrouw: Nee, ik moet eerst naar de apotheek. Ik heb medicijnen nodig.\nMan: Oké, dan zie ik je later.",
                    "readingTime": 25,
                    "options": ["Naar de markt", "Naar de apotheek", "Naar huis"],
                    "correctAnswer": 1,
                    "explanation": "De vrouw zegt: 'Ik moet eerst naar de apotheek. Ik heb medicijnen nodig.'"
                },
                {
                    "id": "l1-q2",
                    "questionText": "Hoe laat begint de les?",
                    "audioFile": "luisteren/exam1/q2.mp3",
                    "transcript": "Vrouw: Wanneer begint de Nederlandse les?\nMan: De les begint om half tien. Maar je moet er om kwart over negen zijn.\nVrouw: Oké, dan kom ik vroeg.",
                    "readingTime": 25,
                    "options": ["Om kwart over negen", "Om half tien", "Om tien uur"],
                    "correctAnswer": 1,
                    "explanation": "De man zegt: 'De les begint om half tien.'"
                },
                {
                    "id": "l1-q3",
                    "questionText": "Wat is het probleem?",
                    "audioFile": "luisteren/exam1/q3.mp3",
                    "transcript": "Vrouw: Goedemorgen, ik bel over mijn bestelling. Ik heb vorige week een tafel besteld, maar ik heb een stoel gekregen.\nMan: Oh, dat spijt me. Ik zoek het voor u uit.",
                    "readingTime": 25,
                    "options": ["De tafel is kapot", "Ze heeft het verkeerde product gekregen", "De bestelling is te laat"],
                    "correctAnswer": 1,
                    "explanation": "De vrouw zegt dat ze een tafel heeft besteld maar een stoel heeft gekregen — het verkeerde product."
                },
                {
                    "id": "l1-q4",
                    "questionText": "Wat moet de man doen?",
                    "audioFile": "luisteren/exam1/q4.mp3",
                    "transcript": "Vrouw: Je hebt morgen een afspraak bij de tandarts om twee uur.\nMan: Oh, ik was het vergeten. Moet ik iets meenemen?\nVrouw: Ja, neem je paspoort en je verzekeringspas mee.",
                    "readingTime": 25,
                    "options": ["Naar de dokter gaan", "Zijn paspoort en verzekeringspas meenemen", "Een afspraak maken"],
                    "correctAnswer": 1,
                    "explanation": "De vrouw zegt: 'Neem je paspoort en je verzekeringspas mee.'"
                },
                {
                    "id": "l1-q5",
                    "questionText": "Waarom kan de man niet komen?",
                    "audioFile": "luisteren/exam1/q5.mp3",
                    "transcript": "Vrouw: Kom je zaterdag naar het feest?\nMan: Nee, helaas niet. Ik moet werken dit weekend.\nVrouw: Jammer! Volgende keer dan.",
                    "readingTime": 25,
                    "options": ["Hij is ziek", "Hij moet werken", "Hij is op vakantie"],
                    "correctAnswer": 1,
                    "explanation": "De man zegt: 'Ik moet werken dit weekend.'"
                },
                {
                    "id": "l1-q6",
                    "questionText": "Wat wil de vrouw kopen?",
                    "audioFile": "luisteren/exam1/q6.mp3",
                    "transcript": "Man: Kan ik u helpen?\nVrouw: Ja, ik zoek een winterjas. Heeft u iets in maat 40?\nMan: Ja, hier hangen een paar jassen. Deze blauwe is in de aanbieding.",
                    "readingTime": 25,
                    "options": ["Een trui", "Een winterjas", "Een blauwe broek"],
                    "correctAnswer": 1,
                    "explanation": "De vrouw zegt: 'Ik zoek een winterjas.'"
                },
                {
                    "id": "l1-q7",
                    "questionText": "Hoe gaat de vrouw naar haar werk?",
                    "audioFile": "luisteren/exam1/q7.mp3",
                    "transcript": "Man: Ga je met de auto naar je werk?\nVrouw: Nee, ik pak altijd de trein. Het is sneller en beter voor het milieu.\nMan: Dat is waar.",
                    "readingTime": 25,
                    "options": ["Met de auto", "Met de trein", "Met de bus"],
                    "correctAnswer": 1,
                    "explanation": "De vrouw zegt: 'Ik pak altijd de trein.'"
                },
                {
                    "id": "l1-q8",
                    "questionText": "Wat is het weer vandaag?",
                    "audioFile": "luisteren/exam1/q8.mp3",
                    "transcript": "Man: Zullen we naar het strand gaan?\nVrouw: Vandaag niet. Het regent de hele dag. Misschien morgen, dan wordt het zonnig.\nMan: Oké, dan gaan we morgen.",
                    "readingTime": 25,
                    "options": ["Het is zonnig", "Het regent", "Het sneeuwt"],
                    "correctAnswer": 1,
                    "explanation": "De vrouw zegt: 'Het regent de hele dag.'"
                },
                {
                    "id": "l1-q9",
                    "questionText": "Hoeveel kinderen heeft de vrouw?",
                    "audioFile": "luisteren/exam1/q9.mp3",
                    "transcript": "Man: Heeft u kinderen?\nVrouw: Ja, ik heb drie kinderen. Twee jongens en een meisje.\nMan: Leuk! Hoe oud zijn ze?\nVrouw: Vijf, acht en twaalf.",
                    "readingTime": 25,
                    "options": ["Twee", "Drie", "Vier"],
                    "correctAnswer": 1,
                    "explanation": "De vrouw zegt: 'Ik heb drie kinderen.'"
                },
                {
                    "id": "l1-q10",
                    "questionText": "Wanneer is de winkel open?",
                    "audioFile": "luisteren/exam1/q10.mp3",
                    "transcript": "Dit is een bericht van Albert Heijn. Wij zijn geopend van maandag tot en met zaterdag van acht uur 's ochtends tot negen uur 's avonds. Op zondag zijn wij gesloten.",
                    "readingTime": 25,
                    "options": ["Elke dag", "Maandag tot en met zaterdag", "Alleen doordeweeks"],
                    "correctAnswer": 1,
                    "explanation": "Het bericht zegt: 'Van maandag tot en met zaterdag.' Op zondag gesloten."
                }
            ]
        }
    }
}
```

**Step 2: Commit**

```bash
git add public/data/luisteren-exercises.json
git commit -m "feat: add luisteren practice exercise data with transcripts"
```

---

### Task 5: Create KNM Exercise Data

**Files:**
- Create: `public/data/knm-exercises.json`

**Step 1: Write exercise data**

Create `public/data/knm-exercises.json` with 20 practice questions across all 6 topic categories, based on typical KNM exam content.

```json
{
    "exams": {
        "exam1": {
            "title": "KNM Oefenexamen 1",
            "questions": [
                {
                    "id": "k1-q1",
                    "category": "Gezondheid",
                    "scenario": "Uw kind heeft koorts (39 graden) en hoest al twee dagen. U maakt zich zorgen.",
                    "image": "knm/gezondheid-1.jpg",
                    "questionText": "Wat doet u eerst?",
                    "options": ["U belt 112", "U belt de huisarts", "U gaat naar de Eerste Hulp in het ziekenhuis"],
                    "correctAnswer": 1,
                    "explanation": "Bij koorts belt u eerst de huisarts. De huisarts beslist of uw kind naar het ziekenhuis moet. 112 is alleen voor levensbedreigende situaties."
                },
                {
                    "id": "k1-q2",
                    "category": "Gezondheid",
                    "scenario": "U bent ziek en kunt niet naar uw werk. U wilt medicijnen kopen.",
                    "questionText": "Waar kunt u medicijnen kopen zonder recept?",
                    "options": ["Bij de huisarts", "Bij de drogist of apotheek", "Bij het ziekenhuis"],
                    "correctAnswer": 1,
                    "explanation": "Medicijnen zonder recept (zoals paracetamol) kunt u kopen bij de drogist of apotheek. Voor sterke medicijnen heeft u een recept van de huisarts nodig."
                },
                {
                    "id": "k1-q3",
                    "category": "Werk & Inkomen",
                    "scenario": "U heeft een baan gevonden. Uw werkgever geeft u een arbeidscontract.",
                    "questionText": "Wat staat er NIET in een arbeidscontract?",
                    "options": ["Uw salaris", "Hoeveel uur u werkt", "De naam van uw huisarts"],
                    "correctAnswer": 2,
                    "explanation": "In een arbeidscontract staan uw salaris, werktijden, vakantiedagen en functie. De naam van uw huisarts staat daar niet in."
                },
                {
                    "id": "k1-q4",
                    "category": "Werk & Inkomen",
                    "scenario": "U werkt in een winkel. U bent al twee weken ziek thuis.",
                    "questionText": "Wie betaalt uw salaris als u ziek bent?",
                    "options": ["De gemeente", "Uw werkgever", "U betaalt zelf"],
                    "correctAnswer": 1,
                    "explanation": "Als u ziek bent, betaalt uw werkgever uw salaris door. Dit is maximaal twee jaar lang (minimaal 70% van uw loon)."
                },
                {
                    "id": "k1-q5",
                    "category": "Wonen",
                    "scenario": "U wilt een huurwoning. U heeft niet veel geld.",
                    "questionText": "Waar schrijft u zich in voor een sociale huurwoning?",
                    "options": ["Bij de gemeente", "Bij een woningcorporatie", "Bij de politie"],
                    "correctAnswer": 1,
                    "explanation": "Voor een sociale huurwoning schrijft u zich in bij een woningcorporatie. De wachttijden kunnen lang zijn, vooral in grote steden."
                },
                {
                    "id": "k1-q6",
                    "category": "Wonen",
                    "scenario": "Het is 23:00 uur. Uw buurman speelt heel harde muziek.",
                    "questionText": "Wat doet u het beste eerst?",
                    "options": ["U belt de politie", "U praat met uw buurman", "U verhuist"],
                    "correctAnswer": 1,
                    "explanation": "In Nederland praat u eerst met uw buurman. Als dat niet helpt, kunt u de wijkagent of een mediator inschakelen."
                },
                {
                    "id": "k1-q7",
                    "category": "Onderwijs",
                    "scenario": "Uw kind is 5 jaar oud.",
                    "questionText": "Moet uw kind naar school?",
                    "options": ["Nee, pas als het kind 6 is", "Ja, de leerplicht begint op 5 jaar", "Alleen als u dat wilt"],
                    "correctAnswer": 1,
                    "explanation": "In Nederland is er leerplicht vanaf 5 jaar. Kinderen moeten naar school tot ze 16 zijn (en deels tot 18)."
                },
                {
                    "id": "k1-q8",
                    "category": "Onderwijs",
                    "scenario": "Uw kind zit op de basisschool. De school organiseert een oudergesprek.",
                    "questionText": "Waarom is het oudergesprek belangrijk?",
                    "options": ["Om eten te brengen voor de leraar", "Om te horen hoe uw kind het doet op school", "Om de school schoon te maken"],
                    "correctAnswer": 1,
                    "explanation": "Bij een oudergesprek bespreekt de leraar hoe uw kind het doet op school. In Nederland vinden ze het belangrijk dat ouders betrokken zijn bij de school."
                },
                {
                    "id": "k1-q9",
                    "category": "Overheid & Recht",
                    "scenario": "U woont in Nederland en u bent 18 jaar of ouder.",
                    "questionText": "Wat MOET u altijd bij u hebben?",
                    "options": ["Uw diploma", "Een geldig identiteitsbewijs", "Uw huurcontract"],
                    "correctAnswer": 1,
                    "explanation": "In Nederland geldt de identificatieplicht. Iedereen van 14 jaar en ouder moet een geldig identiteitsbewijs bij zich hebben (paspoort, ID-kaart of rijbewijs)."
                },
                {
                    "id": "k1-q10",
                    "category": "Overheid & Recht",
                    "scenario": "U verhuist naar een andere stad in Nederland.",
                    "questionText": "Wat moet u doen binnen 5 dagen na uw verhuizing?",
                    "options": ["Een nieuw paspoort aanvragen", "U inschrijven bij de gemeente", "Een brief schrijven naar de koning"],
                    "correctAnswer": 1,
                    "explanation": "Na een verhuizing moet u zich binnen 5 dagen inschrijven bij de nieuwe gemeente. Dit heet 'aangifte van verhuizing'."
                },
                {
                    "id": "k1-q11",
                    "category": "Normen & Waarden",
                    "scenario": "U heeft een afspraak om 14:00 uur bij de tandarts.",
                    "questionText": "Hoe laat komt u het beste?",
                    "options": ["Precies om 14:00 of een paar minuten eerder", "Om 14:30, dat is normaal", "Wanneer u klaar bent met uw werk"],
                    "correctAnswer": 0,
                    "explanation": "In Nederland is op tijd komen heel belangrijk. U komt op tijd of een paar minuten eerder. Te laat komen is onbeleefd."
                },
                {
                    "id": "k1-q12",
                    "category": "Normen & Waarden",
                    "scenario": "Uw collega vraagt: 'Hoe vind je mijn nieuwe kapsel?' U vindt het niet mooi.",
                    "questionText": "Wat past het beste bij de Nederlandse cultuur?",
                    "options": ["U zegt niets en loopt weg", "U zegt eerlijk dat het niet uw smaak is, maar wel vriendelijk", "U zegt dat het heel mooi is (ook al vindt u dat niet)"],
                    "correctAnswer": 1,
                    "explanation": "Nederlanders staan bekend om hun directheid. Ze zeggen eerlijk wat ze vinden, maar wel op een vriendelijke manier."
                },
                {
                    "id": "k1-q13",
                    "category": "Gezondheid",
                    "scenario": "U wilt naar een specialist in het ziekenhuis.",
                    "questionText": "Wat heeft u nodig om naar een specialist te gaan?",
                    "options": ["Een verwijsbrief van de huisarts", "Toestemming van de gemeente", "Niets, u kunt direct gaan"],
                    "correctAnswer": 0,
                    "explanation": "In Nederland gaat u eerst naar de huisarts. De huisarts geeft u een verwijsbrief als u naar een specialist moet. Zonder verwijsbrief betaalt de verzekering niet."
                },
                {
                    "id": "k1-q14",
                    "category": "Werk & Inkomen",
                    "scenario": "U heeft geen werk en zoekt een baan.",
                    "questionText": "Waar kunt u zich inschrijven als werkzoekende?",
                    "options": ["Bij de politie", "Bij het UWV", "Bij de school"],
                    "correctAnswer": 1,
                    "explanation": "Als u werkloos bent, schrijft u zich in bij het UWV (Uitvoeringsinstituut Werknemersverzekeringen). Het UWV kan u helpen met het vinden van werk en een uitkering."
                },
                {
                    "id": "k1-q15",
                    "category": "Wonen",
                    "scenario": "U woont in een flat. Er is een vergadering van de Vereniging van Eigenaren (VvE).",
                    "questionText": "Waarom is het belangrijk om naar de VvE-vergadering te gaan?",
                    "options": ["Om gratis eten te krijgen", "Om mee te beslissen over onderhoud en kosten van het gebouw", "Omdat het verplicht is van de politie"],
                    "correctAnswer": 1,
                    "explanation": "Bij de VvE-vergadering beslist u samen met andere bewoners over onderhoud, schoonmaak en kosten van het gebouw."
                },
                {
                    "id": "k1-q16",
                    "category": "Overheid & Recht",
                    "scenario": "Er zijn gemeenteraadsverkiezingen in uw stad.",
                    "questionText": "Wie mag stemmen bij de gemeenteraadsverkiezingen?",
                    "options": ["Alleen Nederlanders", "Alle inwoners van 18 jaar en ouder die minstens 5 jaar in Nederland wonen", "Alle inwoners van 18 jaar en ouder"],
                    "correctAnswer": 2,
                    "explanation": "Bij gemeenteraadsverkiezingen mogen alle inwoners van 18 jaar en ouder stemmen, ook als ze geen Nederlandse nationaliteit hebben."
                },
                {
                    "id": "k1-q17",
                    "category": "Normen & Waarden",
                    "scenario": "U bent uitgenodigd voor een verjaardagsfeest bij een Nederlandse collega thuis.",
                    "questionText": "Wat is gebruikelijk in Nederland?",
                    "options": ["U feliciteert de jarige en alle familieleden", "U brengt een duur cadeau mee", "U komt zonder iets mee te nemen"],
                    "correctAnswer": 0,
                    "explanation": "In Nederland is het gebruikelijk om op een verjaardag niet alleen de jarige te feliciteren, maar ook de familie en vrienden: 'Gefeliciteerd met je moeder/vader/vriend!'"
                },
                {
                    "id": "k1-q18",
                    "category": "Onderwijs",
                    "scenario": "Uw kind is ziek en kan niet naar school.",
                    "questionText": "Wat moet u doen?",
                    "options": ["Niets, het kind gaat morgen weer", "De school bellen om uw kind ziek te melden", "Een brief schrijven aan de burgemeester"],
                    "correctAnswer": 1,
                    "explanation": "Als uw kind ziek is, moet u de school bellen om het kind ziek te melden. Dit is verplicht vanwege de leerplicht."
                },
                {
                    "id": "k1-q19",
                    "category": "Normen & Waarden",
                    "scenario": "U ziet dat een vrouw een leidinggevende positie heeft op uw werk.",
                    "questionText": "Wat is normaal in Nederland?",
                    "options": ["Dit is ongewoon in Nederland", "In Nederland kunnen mannen en vrouwen dezelfde functies hebben", "Vrouwen werken alleen parttime in Nederland"],
                    "correctAnswer": 1,
                    "explanation": "In Nederland is gelijkheid tussen mannen en vrouwen een belangrijke waarde. Vrouwen en mannen kunnen dezelfde functies en posities hebben."
                },
                {
                    "id": "k1-q20",
                    "category": "Overheid & Recht",
                    "scenario": "U krijgt een boete omdat u door rood licht fietste.",
                    "questionText": "Wat moet u doen met de boete?",
                    "options": ["U gooit de brief weg", "U betaalt de boete op tijd", "U belt de burgemeester"],
                    "correctAnswer": 1,
                    "explanation": "Als u een boete krijgt, moet u deze op tijd betalen. Als u het niet eens bent met de boete, kunt u bezwaar maken. Niet betalen leidt tot hogere kosten."
                }
            ]
        }
    }
}
```

**Step 2: Commit**

```bash
git add public/data/knm-exercises.json
git commit -m "feat: add KNM practice exercise data with 20 questions across 6 categories"
```

---

### Task 6: Build the Spreken Module

**Files:**
- Create: `public/js/spreken.js`

**Step 1: Write the spreken module**

Create `public/js/spreken.js`:

```javascript
import { CountdownTimer, AudioRecorder, ProgressTracker } from './shared.js';

const progress = new ProgressTracker('spreken');
let exerciseData = null;
let currentPartIndex = 0;
let currentExerciseIndex = 0;
let recorder = null;

export async function init(contentArea) {
    const resp = await fetch('/data/spreken-exercises.json');
    exerciseData = await resp.json();
    currentPartIndex = 0;
    currentExerciseIndex = 0;
    renderExerciseList(contentArea);
}

export function renderExerciseList(contentArea) {
    const parts = exerciseData.parts;
    let html = `<div class="exercise-list">
        <h2 style="font-family: var(--font-display); margin-bottom: var(--space-md);">${exerciseData.exam}</h2>`;

    parts.forEach((part, pi) => {
        html += `<div class="exercise-section">
            <h3 class="section-title">Deel ${part.partNumber}: ${part.title}</h3>
            <p class="section-desc">${part.description}</p>
            <div class="exercise-grid">`;
        part.exercises.forEach((ex, ei) => {
            const done = progress.isCompleted(ex.id);
            html += `<button class="exercise-card ${done ? 'completed' : ''}" onclick="window.sprekenStart(${pi}, ${ei})">
                <span class="exercise-num">${ei + 1}</span>
                ${done ? '<span class="check-mark">&#10003;</span>' : ''}
            </button>`;
        });
        html += `</div></div>`;
    });
    html += `</div>`;
    contentArea.innerHTML = html;
}

export async function startExercise(contentArea, partIndex, exerciseIndex) {
    currentPartIndex = partIndex;
    currentExerciseIndex = exerciseIndex;
    const part = exerciseData.parts[partIndex];
    const exercise = part.exercises[exerciseIndex];

    contentArea.innerHTML = `
        <div class="spreken-exercise">
            <div class="exercise-header">
                <span class="exercise-label">Deel ${part.partNumber}: ${part.title}</span>
                <button class="btn-back" onclick="window.sprekenBack()">&#8592; Terug</button>
            </div>
            <div class="exercise-prompt">
                <p>${exercise.prompt}</p>
                ${exercise.images.length > 0 ? `
                    <div class="exercise-images">
                        ${exercise.images.map(img => `
                            <div class="exercise-image">
                                <img src="/images/${img}" alt="Oefening afbeelding"
                                     onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                                <div class="image-placeholder" style="display:none;">
                                    <p>${exercise.tipText || 'Afbeelding niet beschikbaar'}</p>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
                ${exercise.tipText && exercise.images.length === 0 ? `<p class="tip-text"><em>Tip: ${exercise.tipText}</em></p>` : ''}
            </div>
            <div id="timer-area"></div>
            <div id="recorder-area"></div>
            <div id="result-area"></div>
            <div id="action-area">
                <button class="btn btn-primary" id="start-btn" onclick="window.sprekenRecord()">Begin opname</button>
            </div>
        </div>
    `;

    // Preparation phase
    const timerArea = document.getElementById('timer-area');
    const prepTimer = new CountdownTimer(timerArea, part.prepTime, {
        label: 'Voorbereidingstijd',
        onComplete: () => {
            document.getElementById('start-btn').classList.add('pulse');
        }
    });
    prepTimer.start();
}

export async function startRecording() {
    const part = exerciseData.parts[currentPartIndex];
    const exercise = part.exercises[currentExerciseIndex];

    const recorderArea = document.getElementById('recorder-area');
    const timerArea = document.getElementById('timer-area');
    const actionArea = document.getElementById('action-area');

    recorder = new AudioRecorder(recorderArea);
    try {
        await recorder.requestPermission();
    } catch (e) {
        recorderArea.innerHTML = '<p class="error">Microfoontoegang geweigerd. Sta microfoon toe in je browser.</p>';
        return;
    }

    recorder.startRecording();
    actionArea.innerHTML = `<button class="btn btn-secondary" onclick="window.sprekenStopEarly()">Stop eerder</button>`;

    const responseTimer = new CountdownTimer(timerArea, part.responseTime, {
        label: 'Opnametijd',
        onComplete: () => stopAndGrade()
    });
    responseTimer.start();
}

export async function stopEarly() {
    await stopAndGrade();
}

async function stopAndGrade() {
    if (!recorder) return;

    const timerArea = document.getElementById('timer-area');
    timerArea.innerHTML = '';

    const actionArea = document.getElementById('action-area');
    actionArea.innerHTML = '<p>Transcriberen en beoordelen...</p>';

    const audioBlob = await recorder.stopRecording();
    recorder.cleanup();
    recorder = null;

    // Transcribe
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');

    const resultArea = document.getElementById('result-area');

    try {
        const transcribeResp = await fetch('/api/transcribe-speech', { method: 'POST', body: formData });
        const transcribeData = await transcribeResp.json();

        if (!transcribeData.success) {
            resultArea.innerHTML = `<p class="error">${transcribeData.error}</p>`;
            actionArea.innerHTML = `<button class="btn btn-primary" onclick="window.sprekenRecord()">Probeer opnieuw</button>`;
            return;
        }

        resultArea.innerHTML = `
            <div class="transcription-result">
                <h4>Jouw antwoord (getranscribeerd):</h4>
                <blockquote>${transcribeData.transcription}</blockquote>
                <p><em>Beoordeling laden...</em></p>
            </div>`;

        // Grade
        const part = exerciseData.parts[currentPartIndex];
        const exercise = part.exercises[currentExerciseIndex];

        const gradeResp = await fetch('/api/grade-speaking', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                transcription: transcribeData.transcription,
                prompt: exercise.prompt,
                partType: `Deel ${part.partNumber}: ${part.title}`
            })
        });
        const gradeData = await gradeResp.json();

        if (!gradeData.success) {
            resultArea.innerHTML += `<p class="error">${gradeData.error}</p>`;
            return;
        }

        progress.markCompleted(exercise.id);
        displayGrading(resultArea, gradeData.grading, transcribeData.transcription);
        actionArea.innerHTML = `
            <button class="btn btn-primary" onclick="window.sprekenNext()">Volgende oefening</button>
            <button class="btn btn-secondary" onclick="window.sprekenBack()">Terug naar overzicht</button>
        `;
    } catch (e) {
        resultArea.innerHTML = `<p class="error">Er ging iets mis: ${e.message}</p>`;
        actionArea.innerHTML = `<button class="btn btn-primary" onclick="window.sprekenRecord()">Probeer opnieuw</button>`;
    }
}

function displayGrading(container, grading, transcription) {
    const categories = [
        { key: 'adequacy', label: 'Taakuitvoering', max: 2 },
        { key: 'vocabulary', label: 'Woordenschat', max: 2 },
        { key: 'grammar', label: 'Grammatica', max: 2 },
        { key: 'fluency', label: 'Vloeiendheid', max: 2 },
        { key: 'pronunciation', label: 'Uitspraak', max: 2 }
    ];

    let scoresHtml = categories.map(cat => {
        const s = grading.scores[cat.key];
        return `<div class="rubric-score">
            <div class="score-header">
                <span class="score-label">${cat.label}</span>
                <span class="score-value">${s.score}/${cat.max}</span>
            </div>
            <div class="score-bar"><div class="score-fill" style="width: ${(s.score / cat.max) * 100}%"></div></div>
            <p class="score-justification">${s.justification}</p>
        </div>`;
    }).join('');

    container.innerHTML = `
        <div class="grading-result">
            <div class="transcription-block">
                <h4>Jouw antwoord:</h4>
                <blockquote>${transcription}</blockquote>
            </div>
            <div class="total-score">
                <span class="total-label">Totaal</span>
                <span class="total-value">${grading.total}/10</span>
            </div>
            <div class="scores-grid">${scoresHtml}</div>
            ${grading.grammarErrors && grading.grammarErrors.length > 0 ? `
                <div class="errors-section">
                    <h4>Grammaticafouten:</h4>
                    ${grading.grammarErrors.map(e => `
                        <div class="error-item">
                            <span class="error-wrong">${e.error}</span>
                            <span class="error-arrow">&#8594;</span>
                            <span class="error-correct">${e.correction}</span>
                            <p class="error-explanation">${e.explanation}</p>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
            <div class="feedback-section">
                <h4>Feedback:</h4>
                <p>${grading.overallFeedback}</p>
                ${grading.strengths ? `<div class="strengths"><h5>Sterke punten:</h5><ul>${grading.strengths.map(s => `<li>${s}</li>`).join('')}</ul></div>` : ''}
                ${grading.improvements ? `<div class="improvements"><h5>Verbeterpunten:</h5><ul>${grading.improvements.map(s => `<li>${s}</li>`).join('')}</ul></div>` : ''}
            </div>
        </div>
    `;
}

export function nextExercise(contentArea) {
    const part = exerciseData.parts[currentPartIndex];
    if (currentExerciseIndex < part.exercises.length - 1) {
        startExercise(contentArea, currentPartIndex, currentExerciseIndex + 1);
    } else if (currentPartIndex < exerciseData.parts.length - 1) {
        startExercise(contentArea, currentPartIndex + 1, 0);
    } else {
        renderExerciseList(contentArea);
    }
}
```

**Step 2: Commit**

```bash
git add public/js/spreken.js
git commit -m "feat: add spreken module with recording, transcription, and AI grading"
```

---

### Task 7: Build the Luisteren Module

**Files:**
- Create: `public/js/luisteren.js`

**Step 1: Write the luisteren module**

Create `public/js/luisteren.js`:

```javascript
import { CountdownTimer, OneTimeAudioPlayer, ProgressTracker } from './shared.js';

const progress = new ProgressTracker('luisteren');
let exerciseData = null;
let currentExam = 'exam1';
let currentQuestionIndex = 0;
let selectedOption = null;
let answered = false;

export async function init(contentArea) {
    const resp = await fetch('/data/luisteren-exercises.json');
    exerciseData = await resp.json();
    currentQuestionIndex = 0;
    renderQuestionList(contentArea);
}

export function renderQuestionList(contentArea) {
    const exam = exerciseData.exams[currentExam];
    let html = `<div class="exercise-list">
        <h2 style="font-family: var(--font-display); margin-bottom: var(--space-md);">${exam.title}</h2>
        <p style="margin-bottom: var(--space-md); color: var(--text-muted);">25 vragen - Elke audiofragment wordt maar één keer afgespeeld.</p>
        <div class="exercise-grid">`;

    exam.questions.forEach((q, i) => {
        const done = progress.isCompleted(q.id);
        html += `<button class="exercise-card ${done ? 'completed' : ''}" onclick="window.luisterenStart(${i})">
            <span class="exercise-num">${i + 1}</span>
            ${done ? '<span class="check-mark">&#10003;</span>' : ''}
        </button>`;
    });

    html += `</div>
        <div class="progress-summary">
            <p>${progress.getCount()} / ${exam.questions.length} voltooid</p>
        </div>
    </div>`;
    contentArea.innerHTML = html;
}

export function startQuestion(contentArea, questionIndex) {
    currentQuestionIndex = questionIndex;
    selectedOption = null;
    answered = false;

    const exam = exerciseData.exams[currentExam];
    const q = exam.questions[questionIndex];

    contentArea.innerHTML = `
        <div class="luisteren-exercise">
            <div class="exercise-header">
                <span class="exercise-label">Vraag ${questionIndex + 1} / ${exam.questions.length}</span>
                <button class="btn-back" onclick="window.luisterenBack()">&#8592; Terug</button>
            </div>
            <div class="question-prompt">
                <h3>${q.questionText}</h3>
            </div>
            <div id="timer-area"></div>
            <div id="player-area"></div>
            <div class="luisteren-options" id="options-area">
                ${q.options.map((opt, i) => `
                    <button class="option-btn" data-index="${i}" onclick="window.luisterenSelect(${i})" disabled>
                        <span class="option-letter">${String.fromCharCode(65 + i)}</span>
                        <span class="option-text">${opt}</span>
                    </button>
                `).join('')}
            </div>
            <div id="feedback-area"></div>
            <div id="action-area"></div>
        </div>
    `;

    // Reading time phase
    const timerArea = document.getElementById('timer-area');
    const readTimer = new CountdownTimer(timerArea, q.readingTime, {
        label: 'Leestijd - lees de vraag en antwoorden',
        onComplete: () => playAudio(q)
    });
    readTimer.start();
}

function playAudio(question) {
    const timerArea = document.getElementById('timer-area');
    timerArea.innerHTML = '';

    const playerArea = document.getElementById('player-area');

    // Check if audio file exists, otherwise show transcript
    const audio = new Audio(`/audio/${question.audioFile}`);
    audio.onerror = () => {
        // Fallback: show transcript with TTS-style reveal
        playerArea.innerHTML = `
            <div class="transcript-fallback">
                <div class="audio-icon playing">&#128266;</div>
                <p class="transcript-label">Luisterfragment (tekst):</p>
                <p class="transcript-text">${question.transcript.replace(/\n/g, '<br>')}</p>
            </div>
        `;
        // Enable options after a delay proportional to transcript length
        const readDelay = Math.max(3000, question.transcript.length * 50);
        setTimeout(() => enableOptions(), readDelay);
    };

    audio.oncanplaythrough = () => {
        const player = new OneTimeAudioPlayer(playerArea, `/audio/${question.audioFile}`);
        player.play().then(() => enableOptions());
    };

    // Try loading the audio
    audio.load();
}

function enableOptions() {
    document.querySelectorAll('.option-btn').forEach(btn => {
        btn.disabled = false;
    });
    const actionArea = document.getElementById('action-area');
    actionArea.innerHTML = `<button class="btn btn-primary" id="check-btn" onclick="window.luisterenCheck()" disabled>Controleer antwoord</button>`;
}

export function selectOption(index) {
    if (answered) return;
    selectedOption = index;
    document.querySelectorAll('.option-btn').forEach(btn => {
        btn.classList.remove('selected');
    });
    document.querySelector(`.option-btn[data-index="${index}"]`).classList.add('selected');
    const checkBtn = document.getElementById('check-btn');
    if (checkBtn) checkBtn.disabled = false;
}

export function checkAnswer(contentArea) {
    if (selectedOption === null || answered) return;
    answered = true;

    const exam = exerciseData.exams[currentExam];
    const q = exam.questions[currentQuestionIndex];
    const correct = selectedOption === q.correctAnswer;

    document.querySelectorAll('.option-btn').forEach((btn, i) => {
        btn.disabled = true;
        if (i === q.correctAnswer) btn.classList.add('correct');
        if (i === selectedOption && !correct) btn.classList.add('incorrect');
    });

    const feedbackArea = document.getElementById('feedback-area');
    feedbackArea.innerHTML = `
        <div class="feedback ${correct ? 'correct' : 'incorrect'}">
            <p class="feedback-verdict">${correct ? 'Goed!' : 'Helaas, dat is niet juist.'}</p>
            <p class="feedback-explanation">${q.explanation}</p>
        </div>
    `;

    progress.markCompleted(q.id);

    const actionArea = document.getElementById('action-area');
    actionArea.innerHTML = `
        <button class="btn btn-primary" onclick="window.luisterenNext()">Volgende vraag</button>
        <button class="btn btn-secondary" onclick="window.luisterenBack()">Terug naar overzicht</button>
    `;
}

export function nextQuestion(contentArea) {
    const exam = exerciseData.exams[currentExam];
    if (currentQuestionIndex < exam.questions.length - 1) {
        startQuestion(contentArea, currentQuestionIndex + 1);
    } else {
        renderQuestionList(contentArea);
    }
}
```

**Step 2: Commit**

```bash
git add public/js/luisteren.js
git commit -m "feat: add luisteren module with one-time audio playback and MCQ"
```

---

### Task 8: Build the KNM Module

**Files:**
- Create: `public/js/knm.js`

**Step 1: Write the KNM module**

Create `public/js/knm.js`:

```javascript
import { ProgressTracker } from './shared.js';

const progress = new ProgressTracker('knm');
let exerciseData = null;
let currentExam = 'exam1';
let currentQuestionIndex = 0;
let selectedOption = null;
let answered = false;

// Category colors for visual grouping
const categoryColors = {
    'Gezondheid': '#e74c3c',
    'Werk & Inkomen': '#3498db',
    'Wonen': '#2ecc71',
    'Onderwijs': '#f39c12',
    'Overheid & Recht': '#9b59b6',
    'Normen & Waarden': '#e67e22'
};

export async function init(contentArea) {
    const resp = await fetch('/data/knm-exercises.json');
    exerciseData = await resp.json();
    currentQuestionIndex = 0;
    renderQuestionList(contentArea);
}

export function renderQuestionList(contentArea) {
    const exam = exerciseData.exams[currentExam];
    const categories = [...new Set(exam.questions.map(q => q.category))];

    let html = `<div class="exercise-list">
        <h2 style="font-family: var(--font-display); margin-bottom: var(--space-md);">${exam.title}</h2>
        <p style="margin-bottom: var(--space-md); color: var(--text-muted);">Kennis van de Nederlandse Maatschappij - ${exam.questions.length} vragen</p>
        <div class="category-legend">
            ${categories.map(cat => `<span class="cat-badge" style="--cat-color: ${categoryColors[cat] || '#888'}">${cat}</span>`).join('')}
        </div>
        <div class="exercise-grid">`;

    exam.questions.forEach((q, i) => {
        const done = progress.isCompleted(q.id);
        html += `<button class="exercise-card ${done ? 'completed' : ''}" onclick="window.knmStart(${i})"
                    style="border-left: 3px solid ${categoryColors[q.category] || '#888'}">
            <span class="exercise-num">${i + 1}</span>
            ${done ? '<span class="check-mark">&#10003;</span>' : ''}
        </button>`;
    });

    html += `</div>
        <div class="progress-summary">
            <p>${progress.getCount()} / ${exam.questions.length} voltooid</p>
        </div>
    </div>`;
    contentArea.innerHTML = html;
}

export function startQuestion(contentArea, questionIndex) {
    currentQuestionIndex = questionIndex;
    selectedOption = null;
    answered = false;

    const exam = exerciseData.exams[currentExam];
    const q = exam.questions[questionIndex];

    contentArea.innerHTML = `
        <div class="knm-exercise">
            <div class="exercise-header">
                <span class="exercise-label">Vraag ${questionIndex + 1} / ${exam.questions.length}</span>
                <span class="cat-badge" style="--cat-color: ${categoryColors[q.category] || '#888'}">${q.category}</span>
                <button class="btn-back" onclick="window.knmBack()">&#8592; Terug</button>
            </div>
            <div class="scenario-block">
                ${q.image ? `<img src="/images/${q.image}" alt="Scenario" class="scenario-image"
                    onerror="this.style.display='none'">` : ''}
                <p class="scenario-text">${q.scenario}</p>
            </div>
            <div class="question-prompt">
                <h3>${q.questionText}</h3>
            </div>
            <div class="knm-options" id="options-area">
                ${q.options.map((opt, i) => `
                    <button class="option-btn" data-index="${i}" onclick="window.knmSelect(${i})">
                        <span class="option-letter">${String.fromCharCode(65 + i)}</span>
                        <span class="option-text">${opt}</span>
                    </button>
                `).join('')}
            </div>
            <div id="feedback-area"></div>
            <div id="action-area">
                <button class="btn btn-primary" id="check-btn" onclick="window.knmCheck()" disabled>Controleer antwoord</button>
            </div>
        </div>
    `;
}

export function selectOption(index) {
    if (answered) return;
    selectedOption = index;
    document.querySelectorAll('.option-btn').forEach(btn => btn.classList.remove('selected'));
    document.querySelector(`.option-btn[data-index="${index}"]`).classList.add('selected');
    document.getElementById('check-btn').disabled = false;
}

export function checkAnswer(contentArea) {
    if (selectedOption === null || answered) return;
    answered = true;

    const exam = exerciseData.exams[currentExam];
    const q = exam.questions[currentQuestionIndex];
    const correct = selectedOption === q.correctAnswer;

    document.querySelectorAll('.option-btn').forEach((btn, i) => {
        btn.disabled = true;
        if (i === q.correctAnswer) btn.classList.add('correct');
        if (i === selectedOption && !correct) btn.classList.add('incorrect');
    });

    const feedbackArea = document.getElementById('feedback-area');
    feedbackArea.innerHTML = `
        <div class="feedback ${correct ? 'correct' : 'incorrect'}">
            <p class="feedback-verdict">${correct ? 'Goed!' : 'Helaas, dat is niet juist.'}</p>
            <p class="feedback-explanation">${q.explanation}</p>
        </div>
    `;

    progress.markCompleted(q.id);

    const actionArea = document.getElementById('action-area');
    actionArea.innerHTML = `
        <button class="btn btn-primary" onclick="window.knmNext()">Volgende vraag</button>
        <button class="btn btn-secondary" onclick="window.knmBack()">Terug naar overzicht</button>
    `;
}

export function nextQuestion(contentArea) {
    const exam = exerciseData.exams[currentExam];
    if (currentQuestionIndex < exam.questions.length - 1) {
        startQuestion(contentArea, currentQuestionIndex + 1);
    } else {
        renderQuestionList(contentArea);
    }
}
```

**Step 2: Commit**

```bash
git add public/js/knm.js
git commit -m "feat: add KNM module with scenario-based multiple choice"
```

---

### Task 9: Update `index.html` — Add New Mode Tabs & Module Loading

**Files:**
- Modify: `index.html`

This is the integration task. It connects the new modules to the existing app.

**Step 1: Add 3 new mode buttons in the nav area**

Find the existing mode buttons (around line 1268):
```html
<button class="mode-btn schrijven" onclick="startMode('schrijven')">
```

Add after the lezen button:
```html
<button class="mode-btn spreken" onclick="startMode('spreken')">
    <span class="mode-icon">&#127908;</span>Spreken
</button>
<button class="mode-btn luisteren" onclick="startMode('luisteren')">
    <span class="mode-icon">&#128266;</span>Luisteren
</button>
<button class="mode-btn knm" onclick="startMode('knm')">
    <span class="mode-icon">&#127475;&#127473;</span>KNM
</button>
```

**Step 2: Add CSS for new mode buttons and new module styles**

Add in the `<style>` section, alongside existing `.mode-btn.schrijven` and `.mode-btn.lezen` styles:

```css
.mode-btn.spreken {
    border-color: #e74c3c;
}
.mode-btn.spreken:hover, .mode-btn.spreken.active {
    background: #e74c3c;
    color: white;
}
.mode-btn.luisteren {
    border-color: #3498db;
}
.mode-btn.luisteren:hover, .mode-btn.luisteren.active {
    background: #3498db;
    color: white;
}
.mode-btn.knm {
    border-color: #9b59b6;
}
.mode-btn.knm:hover, .mode-btn.knm.active {
    background: #9b59b6;
    color: white;
}

/* Shared new module styles */
.exercise-list { max-width: 800px; margin: 0 auto; }
.exercise-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(60px, 1fr)); gap: 8px; margin: var(--space-sm) 0; }
.exercise-card { padding: 12px; border: 1px solid var(--cream-dark); border-radius: 8px; background: var(--warm-white); cursor: pointer; text-align: center; font-family: var(--font-ui); font-size: 1.1rem; position: relative; transition: all 0.2s; }
.exercise-card:hover { background: var(--cream-dark); transform: translateY(-1px); }
.exercise-card.completed { background: #f0faf0; border-color: #2ecc71; }
.exercise-card .check-mark { position: absolute; top: 2px; right: 4px; color: #2ecc71; font-size: 0.8rem; }
.exercise-section { margin-bottom: var(--space-lg); }
.section-title { font-family: var(--font-display); font-size: 1.2rem; margin-bottom: var(--space-xs); }
.section-desc { color: var(--text-muted); font-size: var(--text-small); margin-bottom: var(--space-sm); }
.exercise-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-md); flex-wrap: wrap; gap: 8px; }
.exercise-label { font-family: var(--font-ui); font-weight: 600; }
.btn-back { background: none; border: 1px solid var(--cream-dark); padding: 6px 12px; border-radius: 6px; cursor: pointer; font-family: var(--font-ui); }
.btn-back:hover { background: var(--cream-dark); }
.progress-summary { text-align: center; margin-top: var(--space-md); color: var(--text-muted); }

/* Countdown timer */
.countdown-timer { text-align: center; margin: var(--space-md) 0; }
.countdown-label { font-family: var(--font-ui); font-size: var(--text-small); color: var(--text-muted); margin-bottom: 4px; }
.countdown-bar { height: 6px; background: var(--cream-dark); border-radius: 3px; overflow: hidden; }
.countdown-fill { height: 100%; border-radius: 3px; transition: width 1s linear; }
.countdown-text { font-family: var(--font-ui); font-size: 1.5rem; font-weight: 600; margin-top: 4px; }

/* Audio recorder */
.recorder-active { display: flex; align-items: center; gap: 12px; justify-content: center; padding: var(--space-md); background: #fff5f5; border-radius: 8px; margin: var(--space-md) 0; }
.recording-indicator { width: 12px; height: 12px; border-radius: 50%; background: #e74c3c; animation: pulse-red 1s infinite; }
@keyframes pulse-red { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
.recorder-done { text-align: center; padding: var(--space-sm); color: #2ecc71; font-weight: 600; }
.pulse { animation: pulse-btn 1s infinite; }
@keyframes pulse-btn { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }

/* Audio player */
.audio-player { display: flex; align-items: center; gap: 12px; padding: var(--space-md); background: var(--warm-white); border: 1px solid var(--cream-dark); border-radius: 8px; margin: var(--space-md) 0; }
.audio-icon { font-size: 1.5rem; }
.audio-icon.playing { animation: pulse-red 1s infinite; }
.audio-progress-bar { flex: 1; height: 6px; background: var(--cream-dark); border-radius: 3px; overflow: hidden; }
.audio-progress-fill { height: 100%; background: var(--dutch-orange); border-radius: 3px; transition: width 0.2s; }
.audio-status { font-size: var(--text-small); color: var(--text-muted); white-space: nowrap; }

/* Transcript fallback */
.transcript-fallback { padding: var(--space-md); background: #f8f9fa; border-radius: 8px; margin: var(--space-md) 0; border-left: 3px solid var(--dutch-orange); }
.transcript-label { font-size: var(--text-small); color: var(--text-muted); margin-bottom: 4px; }
.transcript-text { font-style: italic; line-height: 1.8; }

/* Option buttons (luisteren + knm) */
.luisteren-options, .knm-options { display: flex; flex-direction: column; gap: 8px; margin: var(--space-md) 0; }
.option-btn { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border: 2px solid var(--cream-dark); border-radius: 8px; background: var(--warm-white); cursor: pointer; text-align: left; font-family: var(--font-body); font-size: var(--text-body); transition: all 0.2s; }
.option-btn:hover:not(:disabled) { border-color: var(--dutch-orange); background: #fff8f4; }
.option-btn.selected { border-color: var(--dutch-orange); background: #fff8f4; }
.option-btn.correct { border-color: #2ecc71; background: #f0faf0; }
.option-btn.incorrect { border-color: var(--error-red); background: #fdf0ef; }
.option-btn:disabled { cursor: default; opacity: 0.8; }
.option-letter { font-family: var(--font-ui); font-weight: 600; font-size: 1.1rem; color: var(--dutch-orange); min-width: 24px; }

/* Feedback */
.feedback { padding: var(--space-md); border-radius: 8px; margin: var(--space-md) 0; }
.feedback.correct { background: #f0faf0; border-left: 4px solid #2ecc71; }
.feedback.incorrect { background: #fdf0ef; border-left: 4px solid var(--error-red); }
.feedback-verdict { font-family: var(--font-ui); font-weight: 600; font-size: 1.1rem; margin-bottom: 4px; }
.feedback-explanation { color: var(--navy-mid); }

/* Grading result */
.grading-result { margin-top: var(--space-md); }
.transcription-block { margin-bottom: var(--space-md); }
.transcription-block blockquote { padding: var(--space-sm) var(--space-md); background: var(--warm-white); border-left: 3px solid var(--dutch-orange); border-radius: 4px; font-style: italic; }
.total-score { display: flex; justify-content: space-between; align-items: center; padding: var(--space-md); background: var(--navy-deep); color: var(--cream); border-radius: 8px; margin-bottom: var(--space-md); }
.total-label { font-family: var(--font-ui); font-size: 1.1rem; }
.total-value { font-family: var(--font-display); font-size: 1.5rem; }
.scores-grid { display: grid; gap: 12px; margin-bottom: var(--space-md); }
.rubric-score { padding: var(--space-sm); background: var(--warm-white); border-radius: 8px; }
.score-header { display: flex; justify-content: space-between; margin-bottom: 4px; }
.score-label { font-family: var(--font-ui); font-weight: 600; }
.score-value { font-family: var(--font-ui); color: var(--dutch-orange); }
.score-bar { height: 4px; background: var(--cream-dark); border-radius: 2px; overflow: hidden; }
.score-fill { height: 100%; background: var(--dutch-orange); border-radius: 2px; }
.score-justification { font-size: var(--text-small); color: var(--text-muted); margin-top: 4px; }
.errors-section { margin-bottom: var(--space-md); }
.error-item { padding: 8px; background: #fdf0ef; border-radius: 6px; margin-bottom: 6px; }
.error-wrong { color: var(--error-red); text-decoration: line-through; }
.error-arrow { margin: 0 8px; }
.error-correct { color: #2ecc71; font-weight: 600; }
.error-explanation { font-size: var(--text-small); color: var(--text-muted); margin-top: 2px; }
.strengths h5, .improvements h5 { font-family: var(--font-ui); margin-bottom: 4px; }
.strengths ul, .improvements ul { padding-left: 20px; }
.strengths li, .improvements li { margin-bottom: 2px; }

/* KNM-specific */
.scenario-block { padding: var(--space-md); background: var(--warm-white); border-radius: 8px; margin-bottom: var(--space-md); border: 1px solid var(--cream-dark); }
.scenario-image { max-width: 100%; border-radius: 8px; margin-bottom: var(--space-sm); }
.scenario-text { font-size: 1.05rem; line-height: 1.8; }
.cat-badge { display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: var(--text-small); font-family: var(--font-ui); background: color-mix(in srgb, var(--cat-color) 15%, transparent); color: var(--cat-color); border: 1px solid color-mix(in srgb, var(--cat-color) 30%, transparent); }
.category-legend { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: var(--space-md); }

/* Speaking images */
.exercise-images { display: flex; gap: var(--space-sm); flex-wrap: wrap; margin: var(--space-md) 0; }
.exercise-image { flex: 1; min-width: 150px; }
.exercise-image img { width: 100%; border-radius: 8px; }
.image-placeholder { padding: var(--space-md); background: var(--cream-dark); border-radius: 8px; text-align: center; color: var(--text-muted); font-style: italic; }
.tip-text { color: var(--text-muted); margin-top: var(--space-sm); }
.question-prompt h3 { font-family: var(--font-display); margin-bottom: var(--space-sm); }
```

**Step 3: Add module loading script at the bottom of the HTML**

Before the closing `</body>` tag, add a new `<script type="module">` block:

```html
<script type="module">
    import * as spreken from '/js/spreken.js';
    import * as luisteren from '/js/luisteren.js';
    import * as knm from '/js/knm.js';

    const contentArea = document.getElementById('practice-area') || document.getElementById('question-content');

    function getContentArea() {
        return document.getElementById('question-content') || document.getElementById('practice-area');
    }

    // Spreken global bindings
    window.sprekenStart = (pi, ei) => spreken.startExercise(getContentArea(), pi, ei);
    window.sprekenBack = () => spreken.renderExerciseList(getContentArea());
    window.sprekenRecord = () => spreken.startRecording();
    window.sprekenStopEarly = () => spreken.stopEarly();
    window.sprekenNext = () => spreken.nextExercise(getContentArea());

    // Luisteren global bindings
    window.luisterenStart = (i) => luisteren.startQuestion(getContentArea(), i);
    window.luisterenBack = () => luisteren.renderQuestionList(getContentArea());
    window.luisterenSelect = (i) => luisteren.selectOption(i);
    window.luisterenCheck = () => luisteren.checkAnswer(getContentArea());
    window.luisterenNext = () => luisteren.nextQuestion(getContentArea());

    // KNM global bindings
    window.knmStart = (i) => knm.startQuestion(getContentArea(), i);
    window.knmBack = () => knm.renderQuestionList(getContentArea());
    window.knmSelect = (i) => knm.selectOption(i);
    window.knmCheck = () => knm.checkAnswer(getContentArea());
    window.knmNext = () => knm.nextQuestion(getContentArea());

    // Extend startMode to handle new modes
    const originalStartMode = window.startMode;
    window.startMode = function(mode) {
        if (mode === 'spreken' || mode === 'luisteren' || mode === 'knm') {
            // Update button states
            document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
            document.querySelector(`.mode-btn.${mode}`).classList.add('active');

            document.getElementById('welcome').classList.add('hidden');
            document.getElementById('score-area').classList.add('hidden');
            document.getElementById('practice-area').classList.remove('hidden');

            const area = getContentArea();
            if (mode === 'spreken') spreken.init(area);
            else if (mode === 'luisteren') luisteren.init(area);
            else if (mode === 'knm') knm.init(area);
        } else if (originalStartMode) {
            originalStartMode(mode);
        }
    };
</script>
```

**Step 4: Verify the app starts and new tabs appear**

```bash
npm start
```

Open http://localhost:3456 — verify 5 mode tabs appear and clicking Spreken/Luisteren/KNM shows their exercise lists.

**Step 5: Commit**

```bash
git add index.html
git commit -m "feat: integrate spreken, luisteren, and KNM modules with new mode tabs and styling"
```

---

### Task 10: Update CLAUDE.md with New Architecture & Environment Variables

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update the Architecture section** to reflect the modular structure and new endpoints.

**Step 2: Add `OPENAI_API_KEY` to the Environment Variables table.**

**Step 3: Add documentation for the new exam sections** (speaking rubric, listening format, KNM topics).

**Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with new module architecture and speaking/listening/KNM docs"
```

---

### Task 11: Manual Testing & Polish

**Step 1: Start the server with both API keys**

```bash
PERPLEXITY_API_KEY=your_key OPENAI_API_KEY=your_key npm start
```

**Step 2: Test each new mode end-to-end**

- **Spreken**: Click a Part 1 exercise → verify prep timer → click Start → speak into mic → verify transcription appears → verify grading appears
- **Luisteren**: Click a question → verify reading timer → verify transcript fallback appears (no audio files yet) → select option → check answer → verify feedback
- **KNM**: Click a question → verify scenario + question appear → select option → check → verify feedback with cultural explanation

**Step 3: Fix any visual/functional issues found**

**Step 4: Final commit**

```bash
git add -A
git commit -m "fix: polish and fixes from manual testing"
```
