import { ProgressTracker, sceneImageHTML, setProgress, resultHTML, animateResult } from './shared.js';

const progress = new ProgressTracker('knm');
let exerciseData = null;
let currentExam = 'exam1';
let currentQuestionIndex = 0;
let selectedOption = null;
let answered = false;
let inQuestion = false;
let results = {}; // question id -> answered correctly (this session)

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
    inQuestion = false;
    results = {};
    showOverviewContent(contentArea);
    renderSidebar();
}

export function renderSidebar() {
    const sidebar = document.getElementById('exam-sidebar');
    if (!sidebar || !exerciseData) return;

    const exam = exerciseData.exams[currentExam];
    // Group by category
    const categories = [...new Set(exam.questions.map(q => q.category))];

    let html = '<h3 style="padding: 10px; margin: 0; border-bottom: 1px solid #ddd;">KNM Vragen</h3>';
    categories.forEach(cat => {
        const catQuestions = exam.questions.map((q, i) => ({ ...q, globalIndex: i })).filter(q => q.category === cat);
        const color = categoryColors[cat] || '#888';
        html += `<div class="exam-section">
            <div class="exam-section-title" style="border-left: 3px solid ${color}; padding-left: 8px;">${cat} <span>(${catQuestions.length})</span></div>
            <ul class="exercise-list">`;
        catQuestions.forEach(q => {
            const isActive = inQuestion && currentQuestionIndex === q.globalIndex;
            const isCompleted = progress.isCompleted(q.id);
            html += `<li class="exercise-item ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}"
                onclick="window.knmStart(${q.globalIndex})">
                <span>Vraag ${q.globalIndex + 1}</span>
            </li>`;
        });
        html += '</ul></div>';
    });
    html += `<div class="back-to-menu" onclick="window.backToMenu()">← Back to Menu</div>`;
    sidebar.innerHTML = html;
}

function showOverviewContent(contentArea) {
    const exam = exerciseData.exams[currentExam];
    const categories = [...new Set(exam.questions.map(q => q.category))];
    const done = progress.getCount();
    contentArea.innerHTML = `
        <div class="exercise-title">${exam.title}</div>
        <p class="exercise-instructions">Kennis van de Nederlandse Maatschappij — Kies een vraag in de zijbalk.</p>
        <div class="category-legend" style="margin: var(--space-md) 0;">
            ${categories.map(cat => `<span class="cat-badge" style="--cat-color: ${categoryColors[cat] || '#888'}">${cat}</span>`).join('')}
        </div>
        <p style="color: var(--text-muted);">${done} / ${exam.questions.length} voltooid</p>
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
        <div class="knm-exercise">
            <div class="exercise-header">
                <span class="exercise-label">Vraag ${questionIndex + 1} / ${exam.questions.length}</span>
                <span class="cat-badge" style="--cat-color: ${categoryColors[q.category] || '#888'}">${q.category}</span>
            </div>
            <div class="scenario-block">
                ${sceneImageHTML(q.image, q.imageAlt || q.scenario)}
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
    results[q.id] = correct;
    setProgress((currentQuestionIndex + 1) / exam.questions.length);
    renderSidebar();

    const actionArea = document.getElementById('action-area');
    actionArea.innerHTML = `
        <button class="btn btn-primary" onclick="window.knmNext()">Volgende vraag</button>
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
    contentArea.innerHTML = resultHTML({
        correct, total: answered.length, passFraction: 0.65,
        title: 'KNM — resultaat',
        passText: 'Goed gedaan! Op het echte examen heeft u 65% nodig (26 van 40).',
        failText: 'Blijf oefenen — op het echte examen heeft u 65% nodig (26 van 40).',
        actions: `<div class="rmd-result-actions"><button class="btn btn-primary" onclick="window.knmStart(0)">Opnieuw oefenen</button>
            <button class="btn btn-secondary" onclick="window.knmBack()">Alle vragen</button></div>`,
    });
    animateResult(contentArea);
}
