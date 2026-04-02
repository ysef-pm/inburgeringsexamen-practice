import { CountdownTimer, AudioRecorder, ProgressTracker } from './shared.js';

const progress = new ProgressTracker('spreken');
let exerciseData = null;
let currentExam = 'exam1';
let currentPartIndex = 0;
let currentExerciseIndex = 0;
let recorder = null;
let inExercise = false;

export async function init(contentArea) {
    const resp = await fetch('/data/spreken-exercises.json');
    exerciseData = await resp.json();
    currentPartIndex = 0;
    currentExerciseIndex = 0;
    inExercise = false;
    showExerciseContent(contentArea);
    renderSidebar();
}

export function switchExam(examKey, contentArea) {
    currentExam = examKey;
    currentPartIndex = 0;
    currentExerciseIndex = 0;
    inExercise = false;
    showExerciseContent(contentArea);
    renderSidebar();
}

export function getState() {
    return { exerciseData, currentPartIndex, currentExerciseIndex, inExercise, progress };
}

function getExam() {
    return exerciseData.exams[currentExam];
}

export function renderSidebar() {
    const sidebar = document.getElementById('exam-sidebar');
    if (!sidebar || !exerciseData) return;

    const examKeys = Object.keys(exerciseData.exams);
    let html = '<h3 style="padding: 10px; margin: 0; border-bottom: 1px solid #ddd;">Spreken Exercises</h3>';
    if (examKeys.length > 1) {
        html += `<div style="padding: 10px; border-bottom: 1px solid #ddd;">
            <select style="width: 100%; padding: 8px; border-radius: 5px; border: 1px solid #ccc; font-size: 14px;"
                onchange="window.sprekenSwitchExam(this.value)">
                ${examKeys.map(k => `<option value="${k}" ${k === currentExam ? 'selected' : ''}>${exerciseData.exams[k].title}</option>`).join('')}
            </select>
        </div>`;
    }
    const exam = getExam();
    exam.parts.forEach((part, pi) => {
        html += `<div class="exam-section">
            <div class="exam-section-title">Deel ${part.partNumber}: ${part.title} <span>(${part.exercises.length})</span></div>
            <ul class="exercise-list">`;
        part.exercises.forEach((ex, ei) => {
            const isActive = inExercise && currentPartIndex === pi && currentExerciseIndex === ei;
            const isCompleted = progress.isCompleted(ex.id);
            html += `<li class="exercise-item ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}"
                onclick="window.sprekenStart(${pi}, ${ei})">
                <span>${ei + 1}. Oefening</span>
            </li>`;
        });
        html += '</ul></div>';
    });
    html += `<div class="back-to-menu" onclick="window.backToMenu()">← Back to Menu</div>`;
    sidebar.innerHTML = html;
}

function showExerciseContent(contentArea) {
    const parts = getExam().parts;
    let totalDone = 0;
    let totalExercises = 0;
    parts.forEach(p => {
        totalExercises += p.exercises.length;
        p.exercises.forEach(ex => { if (progress.isCompleted(ex.id)) totalDone++; });
    });

    contentArea.innerHTML = `
        <div class="exercise-title">${getExam().title}</div>
        <p class="exercise-instructions">Kies een oefening in de zijbalk om te beginnen, of klik hieronder.</p>
        <p style="margin-bottom: var(--space-md); color: var(--text-muted);">${totalDone} / ${totalExercises} voltooid</p>
    `;
}

export function renderExerciseList(contentArea) {
    inExercise = false;
    showExerciseContent(contentArea);
    renderSidebar();
}

export async function startExercise(contentArea, partIndex, exerciseIndex) {
    currentPartIndex = partIndex;
    currentExerciseIndex = exerciseIndex;
    inExercise = true;
    renderSidebar();
    const part = getExam().parts[partIndex];
    const exercise = part.exercises[exerciseIndex];

    contentArea.innerHTML = `
        <div class="spreken-exercise">
            <div class="exercise-header">
                <span class="exercise-label">Deel ${part.partNumber}: ${part.title} — Oefening ${exerciseIndex + 1}</span>
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
    const part = getExam().parts[currentPartIndex];
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

    // Convert blob to base64 using FileReader (handles large blobs without stack overflow)
    const base64Audio = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]); // strip data:...;base64, prefix
        reader.readAsDataURL(audioBlob);
    });

    const resultArea = document.getElementById('result-area');

    try {
        const transcribeResp = await fetch('/api/transcribe-speech', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audio: base64Audio, mimeType: audioBlob.type || 'audio/webm' })
        });
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
        const part = getExam().parts[currentPartIndex];
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
        renderSidebar();
        displayGrading(resultArea, gradeData.grading, transcribeData.transcription);
        actionArea.innerHTML = `
            <button class="btn btn-primary" onclick="window.sprekenNext()">Volgende oefening</button>
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
    const part = getExam().parts[currentPartIndex];
    if (currentExerciseIndex < part.exercises.length - 1) {
        startExercise(contentArea, currentPartIndex, currentExerciseIndex + 1);
    } else if (currentPartIndex < getExam().parts.length - 1) {
        startExercise(contentArea, currentPartIndex + 1, 0);
    } else {
        renderExerciseList(contentArea);
    }
}
