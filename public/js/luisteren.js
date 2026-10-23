import { CountdownTimer, OneTimeAudioPlayer, ProgressTracker, sceneImageHTML, setProgress, resultHTML, animateResult } from './shared.js';

const progress = new ProgressTracker('luisteren');
let exerciseData = null;
let currentExam = 'exam1';
let currentQuestionIndex = 0;
let selectedOption = null;
let answered = false;
let inQuestion = false;
let results = {}; // question id -> answered correctly (this session)

export async function init(contentArea) {
    exerciseData = await window.RMDContent.loadContent('luisteren');
    currentQuestionIndex = 0;
    inQuestion = false;
    showOverviewContent(contentArea);
    renderSidebar();
}

export function switchExam(examKey, contentArea) {
    currentExam = examKey;
    currentQuestionIndex = 0;
    selectedOption = null;
    answered = false;
    inQuestion = false;
    results = {};
    showOverviewContent(contentArea);
    renderSidebar();
}

export function renderSidebar() {
    const sidebar = document.getElementById('exam-sidebar');
    if (!sidebar || !exerciseData) return;

    const exam = exerciseData.exams[currentExam];
    const examKeys = Object.keys(exerciseData.exams);
    let html = '<h3 style="padding: 10px; margin: 0; border-bottom: 1px solid #ddd;">Luisteren Vragen</h3>';
    if (examKeys.length > 1) {
        html += `<div style="padding: 10px; border-bottom: 1px solid #ddd;">
            <select style="width: 100%; padding: 8px; border-radius: 5px; border: 1px solid #ccc; font-size: 14px;"
                onchange="window.luisterenSwitchExam(this.value)">
                ${examKeys.map(k => `<option value="${k}" ${k === currentExam ? 'selected' : ''}>${exerciseData.exams[k].title}</option>`).join('')}
            </select>
        </div>`;
    }
    html += `<div class="exam-section">
        <div class="exam-section-title">${exam.title} <span>(${exam.questions.length})</span></div>
        <ul class="exercise-list">`;
    exam.questions.forEach((q, i) => {
        const isActive = inQuestion && currentQuestionIndex === i;
        const isCompleted = progress.isCompleted(q.id);
        const truncated = q.questionText.length > 28 ? q.questionText.substring(0, 25) + '...' : q.questionText;
        html += `<li class="exercise-item ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}"
            onclick="window.luisterenStart(${i})">
            <span title="${q.questionText}">${i + 1}. ${truncated}</span>
        </li>`;
    });
    html += '</ul></div>';
    html += `<div class="back-to-menu" onclick="window.backToMenu()">← Back to Menu</div>`;
    sidebar.innerHTML = html;
}

function showOverviewContent(contentArea) {
    const exam = exerciseData.exams[currentExam];
    const done = progress.getCount();
    contentArea.innerHTML = `
        <div class="exercise-title">${exam.title}</div>
        <p class="exercise-instructions">Kies een vraag in de zijbalk om te beginnen. Elke audiofragment wordt maar één keer afgespeeld.</p>
        <p style="margin-bottom: var(--space-md); color: var(--text-muted);">${done} / ${exam.questions.length} voltooid</p>
    `;
}

export function renderQuestionList(contentArea) {
    inQuestion = false;
    showOverviewContent(contentArea);
    renderSidebar();
}

export function startQuestion(contentArea, questionIndex) {
    currentQuestionIndex = questionIndex;
    selectedOption = null;
    answered = false;
    inQuestion = true;
    renderSidebar();

    const exam = exerciseData.exams[currentExam];
    const q = exam.questions[questionIndex];
    if (questionIndex === 0) results = {}; // starting from question 1 = a new run
    setProgress(questionIndex / exam.questions.length);

    contentArea.innerHTML = `
        <div class="luisteren-exercise">
            <div class="exercise-header">
                <span class="exercise-label">Vraag ${questionIndex + 1} / ${exam.questions.length}</span>
            </div>
            ${sceneImageHTML(q.image, q.imageAlt)}
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
    // No preload probe: iOS Safari won't fetch audio before a user gesture,
    // so waiting for canplaythrough would hang forever there.
    const player = new OneTimeAudioPlayer(playerArea, `/audio/${question.audioFile}`);
    let settled = false;

    const showTranscript = () => {
        if (settled) return;
        settled = true;
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

    // Broken or missing audio file → show the transcript instead
    player.audio.onerror = showTranscript;

    const onPlayed = () => {
        settled = true;
        enableOptions();
    };

    player.play().then(onPlayed).catch((err) => {
        if (settled) return;
        if (err && err.name === 'NotAllowedError') {
            // Safari/iOS block play() outside a user gesture — offer a tap instead
            const btn = document.createElement('button');
            btn.className = 'btn btn-primary';
            btn.id = 'play-audio-btn';
            btn.textContent = '▶ Speel fragment af';
            btn.onclick = () => {
                btn.remove();
                player.play().then(onPlayed).catch(showTranscript);
            };
            playerArea.appendChild(btn);
        } else {
            showTranscript();
        }
    });
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
    results[q.id] = correct;
    setProgress((currentQuestionIndex + 1) / exam.questions.length);
    renderSidebar();

    const actionArea = document.getElementById('action-area');
    actionArea.innerHTML = `
        <button class="btn btn-primary" onclick="window.luisterenNext()">Volgende vraag</button>
    `;
}

export function nextQuestion(contentArea) {
    const exam = exerciseData.exams[currentExam];
    if (currentQuestionIndex < exam.questions.length - 1) {
        startQuestion(contentArea, currentQuestionIndex + 1);
    } else {
        showResult(contentArea);
    }
}

// End-of-set result: score over the questions answered this session.
function showResult(contentArea) {
    const exam = exerciseData.exams[currentExam];
    const answered = exam.questions.filter(q => q.id in results);
    if (answered.length === 0) { renderQuestionList(contentArea); return; }
    inQuestion = false;
    renderSidebar();
    const correct = answered.filter(q => results[q.id]).length;
    const isA2 = !window.RMDContent || window.RMDContent.getLevel() === 'a2';
    contentArea.innerHTML = resultHTML({
        correct, total: answered.length, passFraction: 0.72,
        title: `${exam.title} — resultaat`,
        // A2 pass mark is known (18-19 of 25); B1 copy stays generic.
        passText: isA2 ? 'Goed gedaan! Op het echte A2-examen heeft u ongeveer 72% nodig (18 van 25).' : 'Goed gedaan! Probeer ook de andere oefenexamens.',
        failText: isA2 ? 'Blijf oefenen — op het echte A2-examen heeft u ongeveer 72% nodig (18 van 25).' : 'Blijf oefenen — lees de uitleg bij de vragen die fout gingen.',
        actions: `<div class="rmd-result-actions"><button class="btn btn-primary" onclick="window.luisterenStart(0)">Opnieuw oefenen</button>
            <button class="btn btn-secondary" onclick="window.luisterenBack()">Alle vragen</button></div>`,
    });
    animateResult(contentArea);
}
