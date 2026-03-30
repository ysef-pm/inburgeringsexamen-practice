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
