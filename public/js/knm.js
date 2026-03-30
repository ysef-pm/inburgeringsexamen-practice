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
