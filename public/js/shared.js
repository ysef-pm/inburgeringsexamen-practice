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
        const fill = this.container.querySelector('#audio-fill');
        const status = this.container.querySelector('#audio-status');

        this.audio.ontimeupdate = () => {
            const pct = (this.audio.currentTime / this.audio.duration) * 100;
            fill.style.width = `${pct}%`;
        };

        return new Promise((resolve, reject) => {
            this.audio.onended = () => {
                fill.style.width = '100%';
                status.textContent = 'Afgespeeld - kies je antwoord';
                resolve();
            };
            // hasPlayed only flips once playback actually starts, so a
            // blocked autoplay attempt can be retried from a user gesture
            this.audio.play().then(() => {
                this.hasPlayed = true;
                status.textContent = 'Afspelen...';
            }).catch(reject);
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

// ===== Visual layer: scene illustrations + tasteful motion =====
// One helper set for every mode. Also exposed as window.RMDVisual so the
// legacy inline schrijven/lezen script in index.html uses the same code.
// Everything degrades silently: no image → no card; reduced motion → no motion.

function prefersReducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
}

function escAttr(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/**
 * Markup for a rounded illustration card. `src` is relative to /images/
 * (e.g. "scenes/knm/k1-q1.webp"). The card reserves its box via CSS
 * aspect-ratio (no layout shift), lazy-loads, fades in on load and removes
 * itself if the file is missing.
 */
export function sceneImageHTML(src, alt, { variant = 'banner' } = {}) {
    if (!src) return '';
    return `<figure class="scene-card scene-${variant}">` +
        `<img src="/images/${escAttr(src)}" alt="${escAttr(alt || '')}" loading="lazy" decoding="async" width="1024" height="1024"` +
        ` onload="this.parentNode.classList.add('is-loaded')" onerror="this.parentNode.remove()">` +
        `</figure>`;
}

/** Insert a scene card at the top of `el` (no-op without src/el). */
export function renderSceneImage(el, src, alt, opts) {
    if (!el || !src) return null;
    el.insertAdjacentHTML('afterbegin', sceneImageHTML(src, alt, opts));
    return el.firstElementChild;
}

/** Animate the shared #progress bar to `fraction` (0..1). */
export function setProgress(fraction) {
    const fill = document.getElementById('progress');
    if (!fill) return;
    const pct = Math.max(0, Math.min(1, Number(fraction) || 0)) * 100;
    fill.style.width = `${pct}%`;
}

/** Count a number up inside `el` (keeps any other text via `format`). */
export function countUp(el, to, { from = 0, duration = 900, format = (n) => String(n) } = {}) {
    if (!el) return;
    if (prefersReducedMotion() || to === from) { el.textContent = format(to); return; }
    const start = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    function frame(now) {
        const t = Math.min(1, (now - start) / duration);
        el.textContent = format(t < 1 ? Math.round(from + (to - from) * ease(t)) : to);
        if (t < 1) requestAnimationFrame(frame);
    }
    el.textContent = format(from);
    requestAnimationFrame(frame);
}

/** Light, hand-rolled confetti burst (~1.6s), palette-matched. */
export function confetti({ count = 90, duration = 1700 } = {}) {
    if (prefersReducedMotion() || typeof document === 'undefined') return;
    const canvas = document.createElement('canvas');
    canvas.className = 'rmd-confetti';
    canvas.setAttribute('aria-hidden', 'true');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth, H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const colors = ['#d4652a', '#c9a962', '#1a2332', '#7fa38a', '#8fb8d8', '#e9b44c'];
    const parts = Array.from({ length: count }, () => ({
        x: W / 2 + (Math.random() - 0.5) * W * 0.3,
        y: H * 0.35,
        vx: (Math.random() - 0.5) * 9,
        vy: -Math.random() * 9 - 3,
        r: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        w: 6 + Math.random() * 6,
        h: 3 + Math.random() * 4,
        c: colors[(Math.random() * colors.length) | 0],
    }));
    const start = performance.now();
    function frame(now) {
        const t = now - start;
        ctx.clearRect(0, 0, W, H);
        ctx.globalAlpha = Math.max(0, 1 - t / duration);
        for (const p of parts) {
            p.vy += 0.25; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
            ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
            ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            ctx.restore();
        }
        if (t < duration) requestAnimationFrame(frame);
        else canvas.remove();
    }
    requestAnimationFrame(frame);
}

/**
 * Result block used by lezen / luisteren / KNM summaries.
 * Returns markup; call animateResult(container) after inserting it.
 */
export function resultHTML({ correct, total, passFraction, title, passText, failText, actions = '' }) {
    const passed = total > 0 && correct / total >= passFraction;
    return `<div class="rmd-result ${passed ? 'passed' : ''}" data-correct="${correct}" data-total="${total}" data-passed="${passed}">
        <h2 class="rmd-result-title">${title}</h2>
        <div class="rmd-result-score"><span class="rmd-result-num">${correct}</span><span class="rmd-result-of">/ ${total}</span></div>
        <div class="rmd-result-bar"><div class="rmd-result-fill"></div></div>
        <p class="rmd-result-verdict">${passed ? passText : failText}</p>
        ${actions}
    </div>`;
}

export function animateResult(container) {
    const box = container && container.querySelector('.rmd-result');
    if (!box) return;
    const correct = Number(box.dataset.correct), total = Number(box.dataset.total);
    countUp(box.querySelector('.rmd-result-num'), correct, { duration: 1000 });
    const fill = box.querySelector('.rmd-result-fill');
    requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = `${total ? (correct / total) * 100 : 0}%`; }));
    if (box.dataset.passed === 'true') setTimeout(() => confetti(), 650);
}

if (typeof window !== 'undefined') {
    window.RMDVisual = { sceneImageHTML, renderSceneImage, setProgress, countUp, confetti, resultHTML, animateResult, prefersReducedMotion };
}
