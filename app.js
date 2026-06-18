// Audio System using Web Audio API
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let soundEnabled = true;

function playTone(freq, type, duration, vol=0.1) {
    if (!soundEnabled) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(freq, audioCtx.currentTime);
    
    gainNode.gain.setValueAtTime(vol, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + duration);
}

const sfx = {
    click: () => playTone(600, 'sine', 0.1, 0.05),
    error: () => {
        playTone(300, 'sawtooth', 0.1, 0.1);
        setTimeout(() => playTone(250, 'sawtooth', 0.2, 0.1), 100);
    },
    success: () => {
        playTone(400, 'sine', 0.1, 0.1);
        setTimeout(() => playTone(600, 'sine', 0.1, 0.1), 100);
        setTimeout(() => playTone(800, 'sine', 0.3, 0.1), 200);
    },
    gameover: () => {
        playTone(300, 'square', 0.2, 0.1);
        setTimeout(() => playTone(250, 'square', 0.3, 0.1), 200);
        setTimeout(() => playTone(200, 'square', 0.4, 0.1), 500);
    }
};

// Application State
const state = {
    currentScreen: 'screen-home',
    difficulty: 'medium',
    sessionId: null,
    maxRange: 100,
    maxAttempts: 6,
    attemptsLeft: 6,
    gameOver: false
};

// Core Logic
const app = {
    init() {
        this.bindEvents();
        this.loadStats();
        
        // Sound toggle
        document.getElementById('soundToggle').addEventListener('click', () => {
            soundEnabled = !soundEnabled;
            document.getElementById('icon-sound-on').classList.toggle('hidden', !soundEnabled);
            document.getElementById('icon-sound-off').classList.toggle('hidden', soundEnabled);
            if (soundEnabled) sfx.click();
        });
    },

    bindEvents() {
        // Add click sounds to all buttons
        document.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => {
                if(btn.id !== 'soundToggle') sfx.click();
            });
        });

        // Enter key for guess
        document.getElementById('guess-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.submitGuess();
        });
    },

    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        setTimeout(() => {
            document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
            const target = document.getElementById(screenId);
            target.classList.remove('hidden');
            // Slight delay for transition
            setTimeout(() => target.classList.add('active'), 50);
        }, 400); // Wait for fade out
        state.currentScreen = screenId;
        
        if(screenId === 'screen-highscores') this.loadHighScores();
        if(screenId === 'screen-stats') this.renderStats();
    },

    async startGame(diff) {
        state.difficulty = diff || state.difficulty;
        const withHint = document.getElementById('hint-toggle') ? document.getElementById('hint-toggle').checked : true;
        
        try {
            const res = await fetch('/api/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `difficulty=${state.difficulty}&withHint=${withHint}`
            });
            const data = await res.json();
            
            state.sessionId = data.sessionId;
            state.maxRange = data.maxRange;
            state.maxAttempts = data.maxAttempts;
            state.attemptsLeft = data.maxAttempts;
            state.gameOver = false;
    
            // Update UI
            document.getElementById('game-range-text').textContent = `Guess between 1 and ${state.maxRange}`;
            document.getElementById('guess-input').value = '';
            document.getElementById('hint-display').textContent = '';
            document.getElementById('game-feedback').textContent = '';
            
            // Reset progress bar
            document.getElementById('attempts-progress').style.width = '100%';
            document.getElementById('attempts-progress').style.backgroundColor = 'var(--accent-secondary)';
            
            this.updateStatsUI();
            this.showScreen('screen-game');
            setTimeout(() => document.getElementById('guess-input').focus(), 500);
            
        } catch (e) {
            console.error(e);
            this.showToast("Could not connect to Java backend");
        }
    },

    updateStatsUI() {
        document.getElementById('game-attempts').textContent = state.attemptsLeft;
        
        const pct = (state.attemptsLeft / state.maxAttempts) * 100;
        const bar = document.getElementById('attempts-progress');
        bar.style.width = `${pct}%`;
        
        if(pct <= 30) bar.style.backgroundColor = 'var(--danger)';
        else if(pct <= 60) bar.style.backgroundColor = 'var(--warning)';
    },

    async submitGuess() {
        if (state.gameOver || !state.sessionId) return;
        
        const input = document.getElementById('guess-input');
        const guess = parseInt(input.value);
        const feedback = document.getElementById('game-feedback');
        const hintDisplay = document.getElementById('hint-display');

        if (isNaN(guess) || guess < 1 || guess > state.maxRange) {
            this.showToast(`Please enter a number between 1 and ${state.maxRange}`);
            input.value = '';
            return;
        }

        try {
            const res = await fetch('/api/guess', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `sessionId=${state.sessionId}&guess=${guess}`
            });
            
            if (!res.ok) {
                this.showToast("Invalid guess or session expired");
                return;
            }
            
            const result = await res.json();
            
            state.attemptsLeft = result.attemptsLeft;
            this.updateStatsUI();
            
            if (result.status === 'win') {
                this.handleWin(result.score, guess); // Target is guess
            } else if (result.status === 'loss') {
                this.handleLoss(result.targetNumber);
            } else {
                sfx.error();
                this.shakeInput();
                input.value = '';
                
                feedback.style.color = result.direction === 'lower' ? 'var(--warning)' : 'var(--accent-secondary)';
                feedback.textContent = result.direction === 'lower' ? '👇 Try lower' : '👆 Try higher';
                
                if (result.hint && result.hint.trim() !== "") {
                    hintDisplay.textContent = result.hint;
                    this.triggerFadeIn(hintDisplay);
                }
            }
            
        } catch (e) {
            console.error(e);
            this.showToast("Error communicating with backend");
        }
    },

    triggerFadeIn(element) {
        element.classList.remove('fade-in');
        void element.offsetWidth; // trigger reflow
        element.classList.add('fade-in');
    },

    shakeInput() {
        const container = document.getElementById('guess-container');
        container.classList.remove('shake');
        void container.offsetWidth;
        container.classList.add('shake');
    },

    handleWin(score, targetNumber) {
        state.gameOver = true;
        sfx.success();
        this.shootConfetti();
        this.updateGlobalStats(true, score);
        this.showEndModal(true, score, targetNumber);
    },

    handleLoss(targetNumber) {
        state.gameOver = true;
        sfx.gameover();
        this.updateGlobalStats(false, 0);
        this.showEndModal(false, 0, targetNumber);
    },

    async showEndModal(isWin, score, targetNumber) {
        const modal = document.getElementById('game-over-modal');
        document.getElementById('end-title').textContent = isWin ? 'Victory!' : 'Game Over';
        document.getElementById('end-title').className = isWin ? 'gradient-text' : 'highlight';
        document.getElementById('end-number').textContent = targetNumber;
        document.getElementById('end-score').textContent = score;
        
        const highScoreStatus = isWin && await this.isHighScore(score);
        document.getElementById('new-highscore-input').classList.toggle('hidden', !highScoreStatus);
        if (highScoreStatus) {
            document.getElementById('player-name').value = '';
        }
        
        modal.classList.remove('hidden');
    },

    async isHighScore(score) {
        try {
            const res = await fetch('/api/scores');
            const scores = await res.json();
            if (scores.length < 10) return true;
            return score > scores[scores.length - 1].score;
        } catch (e) {
            // Fallback if offline
            return true;
        }
    },

    async saveHighScore(score) {
        const input = document.getElementById('player-name');
        if (!document.getElementById('new-highscore-input').classList.contains('hidden')) {
            const name = input.value.trim() || 'Anonymous';
            try {
                await fetch('/api/scores', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: `name=${encodeURIComponent(name)}&score=${score}`
                });
            } catch (e) {
                console.error("Could not save to global leaderboard");
            }
        }
    },

    async saveAndRestart() {
        const currentScore = parseInt(document.getElementById('end-score').textContent);
        await this.saveHighScore(currentScore);
        document.getElementById('game-over-modal').classList.add('hidden');
        this.startGame(state.difficulty);
    },

    async saveAndHome() {
        const currentScore = parseInt(document.getElementById('end-score').textContent);
        await this.saveHighScore(currentScore);
        document.getElementById('game-over-modal').classList.add('hidden');
        this.showScreen('screen-home');
    },

    confirmQuit() {
        if(confirm("Are you sure you want to quit? This will count as a loss.")) {
            this.updateGlobalStats(false, 0);
            this.showScreen('screen-home');
        }
    },

    updateGlobalStats(isWin, score) {
        const stats = JSON.parse(localStorage.getItem('stats') || '{"played":0,"wins":0,"losses":0,"totalScore":0}');
        stats.played++;
        if (isWin) {
            stats.wins++;
            stats.totalScore += score;
        } else {
            stats.losses++;
        }
        localStorage.setItem('stats', JSON.stringify(stats));
    },

    renderStats() {
        const stats = JSON.parse(localStorage.getItem('stats') || '{"played":0,"wins":0,"losses":0,"totalScore":0}');
        document.getElementById('stat-played').textContent = stats.played;
        document.getElementById('stat-wins').textContent = stats.wins;
        document.getElementById('stat-losses').textContent = stats.losses;
        const avg = stats.wins > 0 ? Math.round(stats.totalScore / stats.wins) : 0;
        document.getElementById('stat-avg').textContent = avg;
    },

    async loadHighScores() {
        const list = document.getElementById('highscores-list');
        list.innerHTML = '<p class="text-center text-secondary mt-3">Loading global scores...</p>';
        
        try {
            const res = await fetch('/api/scores');
            const scores = await res.json();
            
            if (scores.length === 0) {
                list.innerHTML = '<p class="text-center text-secondary mt-3">No scores yet. Be the first!</p>';
                return;
            }
            
            list.innerHTML = scores.map((s, i) => `
                <div class="score-item">
                    <span class="score-rank">#${i + 1}</span>
                    <span class="score-name">${s.name}</span>
                    <span class="score-val">${s.score}</span>
                </div>
            `).join('');
        } catch (e) {
            list.innerHTML = '<p class="text-center text-secondary mt-3">Could not connect to global leaderboard.</p>';
        }
    },

    loadStats() {},

    showToast(msg) {
        const toast = document.getElementById('toast');
        toast.textContent = msg;
        toast.classList.remove('hidden');
        setTimeout(() => toast.classList.add('hidden'), 3000);
    },

    shootConfetti() {
        const canvas = document.getElementById('confetti-canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const pieces = [];
        const colors = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444'];

        for (let i = 0; i < 100; i++) {
            pieces.push({
                x: canvas.width / 2,
                y: canvas.height / 2 + 100,
                vx: (Math.random() - 0.5) * 20,
                vy: (Math.random() - 1) * 20 - 5,
                size: Math.random() * 10 + 5,
                color: colors[Math.floor(Math.random() * colors.length)],
                rotation: Math.random() * 360,
                rs: (Math.random() - 0.5) * 10
            });
        }

        function animate() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            let active = false;
            
            pieces.forEach(p => {
                p.x += p.vx;
                p.y += p.vy;
                p.vy += 0.5; // gravity
                p.rotation += p.rs;
                
                if (p.y < canvas.height) active = true;

                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rotation * Math.PI / 180);
                ctx.fillStyle = p.color;
                ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size);
                ctx.restore();
            });

            if (active) requestAnimationFrame(animate);
            else ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        animate();
    }
};

window.addEventListener('DOMContentLoaded', () => app.init());
