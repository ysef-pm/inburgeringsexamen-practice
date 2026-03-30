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
