/**
 * Voice Assistant - Client-side JavaScript
 * Handles speech recognition, audio visualization, and API communication
 */

class VoiceAssistant {
    constructor() {
        // DOM Elements
        this.voiceBtn = document.getElementById('voiceBtn');
        this.voiceBtnLabel = document.getElementById('voiceBtnLabel');
        this.statusIndicator = document.getElementById('statusIndicator');
        this.statusText = document.getElementById('statusText');
        this.transcriptText = document.getElementById('transcriptText');
        this.responseText = document.getElementById('responseText');
        this.audioCanvas = document.getElementById('audioCanvas');
        this.settingsToggle = document.getElementById('settingsToggle');
        this.settingsContent = document.getElementById('settingsContent');
        this.voiceSelect = document.getElementById('voiceSelect');
        this.modelSelect = document.getElementById('modelSelect');
        this.speedRange = document.getElementById('speedRange');
        this.speedValue = document.getElementById('speedValue');
        this.ollamaStatus = document.getElementById('ollamaStatus');
        this.kokoroStatus = document.getElementById('kokoroStatus');

        // Canvas context for visualization
        this.canvasCtx = this.audioCanvas.getContext('2d');

        // State
        this.isListening = false;
        this.isProcessing = false;
        this.isSpeaking = false;
        this.recognition = null;
        this.audioContext = null;
        this.analyser = null;
        this.mediaStream = null;
        this.animationId = null;
        this.currentAudio = null;
        this.conversationHistory = [];

        // Transcript state
        this.interimTranscript = '';
        this.finalTranscript = '';
        this.silenceTimer = null;
        this.lastSpeechTime = null;

        // Configuration
        this.config = {
            silenceThreshold: 2000,
            minSpeechLength: 500,
            selectedVoice: 'af_heart',
            selectedModel: 'llama3.2:latest',
            speechSpeed: 1.0
        };

        // Initialize
        this.init();
    }

    async init() {
        // Set up event listeners
        this.voiceBtn.addEventListener('click', () => this.toggleListening());
        this.settingsToggle.addEventListener('click', () => this.toggleSettings());
        this.speedRange.addEventListener('input', (e) => this.updateSpeed(e.target.value));

        // Load settings
        await this.loadSettings();

        // Check service health
        await this.checkHealth();

        // Resize canvas
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());

        // Start idle animation
        this.drawIdleVisualization();
    }

    async loadSettings() {
        try {
            // Load voices
            const voicesRes = await fetch('/api/voices');
            if (voicesRes.ok) {
                const data = await voicesRes.json();
                this.populateVoices(data.voices || []);
            }

            // Load models
            const modelsRes = await fetch('/api/models');
            if (modelsRes.ok) {
                const data = await modelsRes.json();
                this.populateModels(data.models || []);
            }
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
    }

    populateVoices(voices) {
        // Clear existing options
        while (this.voiceSelect.firstChild) {
            this.voiceSelect.removeChild(this.voiceSelect.firstChild);
        }

        // Group voices by type
        const groups = {
            'American Female': voices.filter(v => v.startsWith('af_')),
            'American Male': voices.filter(v => v.startsWith('am_')),
            'British Female': voices.filter(v => v.startsWith('bf_')),
            'British Male': voices.filter(v => v.startsWith('bm_')),
            'Other': voices.filter(v => !v.match(/^[ab][mf]_/))
        };

        for (const [groupName, groupVoices] of Object.entries(groups)) {
            if (groupVoices.length === 0) continue;

            const optgroup = document.createElement('optgroup');
            optgroup.label = groupName;

            for (const voice of groupVoices) {
                const option = document.createElement('option');
                option.value = voice;
                option.textContent = voice.replace(/_/g, ' ');
                if (voice === this.config.selectedVoice) {
                    option.selected = true;
                }
                optgroup.appendChild(option);
            }

            this.voiceSelect.appendChild(optgroup);
        }

        this.voiceSelect.addEventListener('change', (e) => {
            this.config.selectedVoice = e.target.value;
        });
    }

    populateModels(models) {
        // Clear existing options
        while (this.modelSelect.firstChild) {
            this.modelSelect.removeChild(this.modelSelect.firstChild);
        }

        for (const model of models) {
            const option = document.createElement('option');
            option.value = model.name;
            option.textContent = `${model.name} (${this.formatSize(model.size)})`;
            if (model.name === this.config.selectedModel) {
                option.selected = true;
            }
            this.modelSelect.appendChild(option);
        }

        this.modelSelect.addEventListener('change', (e) => {
            this.config.selectedModel = e.target.value;
        });
    }

    formatSize(bytes) {
        const gb = bytes / (1024 * 1024 * 1024);
        return `${gb.toFixed(1)}GB`;
    }

    updateSpeed(value) {
        this.config.speechSpeed = parseFloat(value);
        this.speedValue.textContent = `${value}x`;
    }

    toggleSettings() {
        this.settingsContent.classList.toggle('open');
    }

    async checkHealth() {
        try {
            const res = await fetch('/api/health');
            const data = await res.json();

            this.ollamaStatus.className = 'service-dot ' +
                (data.services.ollama === 'healthy' ? 'healthy' : 'unhealthy');
            this.kokoroStatus.className = 'service-dot ' +
                (data.services.kokoro === 'healthy' ? 'healthy' : 'unhealthy');
        } catch (error) {
            console.error('Health check failed:', error);
        }
    }

    resizeCanvas() {
        const rect = this.audioCanvas.parentElement.getBoundingClientRect();
        this.audioCanvas.width = rect.width - 48; // Account for padding
        this.audioCanvas.height = 150;
    }

    async toggleListening() {
        if (this.isListening) {
            await this.stopListening();
        } else {
            await this.startListening();
        }
    }

    async startListening() {
        try {
            // Check for speech recognition support
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition) {
                this.showError('Speech recognition not supported in this browser');
                return;
            }

            // Request microphone access
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // Set up audio context for visualization
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;

            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            source.connect(this.analyser);

            // Set up speech recognition
            this.recognition = new SpeechRecognition();
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.lang = 'en-US';

            this.recognition.onstart = () => {
                this.isListening = true;
                this.updateStatus('listening', 'Listening...');
                this.voiceBtn.classList.add('listening');
                this.voiceBtnLabel.textContent = 'Tap to stop';
                this.startVisualization();
            };

            this.recognition.onresult = (event) => this.handleSpeechResult(event);
            this.recognition.onerror = (event) => this.handleSpeechError(event);
            this.recognition.onend = () => this.handleRecognitionEnd();

            this.recognition.start();
            this.finalTranscript = '';
            this.interimTranscript = '';

        } catch (error) {
            console.error('Failed to start listening:', error);
            this.showError('Microphone access denied');
        }
    }

    async stopListening() {
        this.isListening = false;

        if (this.recognition) {
            this.recognition.stop();
            this.recognition = null;
        }

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        if (this.audioContext) {
            await this.audioContext.close();
            this.audioContext = null;
            this.analyser = null;
        }

        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
        }

        this.stopVisualization();
        this.voiceBtn.classList.remove('listening', 'has-audio');
        this.voiceBtnLabel.textContent = 'Tap to speak';

        if (!this.isProcessing && !this.isSpeaking) {
            this.updateStatus('', 'Ready');
        }
    }

    handleSpeechResult(event) {
        let currentInterim = '';
        let currentFinal = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            if (result.isFinal) {
                currentFinal += result[0].transcript;
            } else {
                currentInterim += result[0].transcript;
            }
        }

        // Barge-in detection - stop speaking if user starts talking
        if ((currentInterim || currentFinal) && this.isSpeaking && this.currentAudio) {
            this.fadeOutAudio();
        }

        // Update display
        if (currentInterim) {
            this.interimTranscript = currentInterim;
            this.voiceBtn.classList.add('has-audio');
            this.lastSpeechTime = Date.now();
            this.resetSilenceTimer();
        }

        if (currentFinal) {
            this.finalTranscript += currentFinal;
            this.interimTranscript = '';
            this.startSilenceTimer();
        }

        this.updateTranscriptDisplay();
    }

    updateTranscriptDisplay() {
        // Clear existing content safely
        while (this.transcriptText.firstChild) {
            this.transcriptText.removeChild(this.transcriptText.firstChild);
        }

        if (this.finalTranscript || this.interimTranscript) {
            // Add final transcript as text node
            if (this.finalTranscript) {
                this.transcriptText.appendChild(document.createTextNode(this.finalTranscript));
            }

            // Add interim transcript with styling
            if (this.interimTranscript) {
                const interimSpan = document.createElement('span');
                interimSpan.className = 'interim';
                interimSpan.textContent = this.interimTranscript;
                this.transcriptText.appendChild(interimSpan);
            }
        } else {
            const placeholder = document.createElement('span');
            placeholder.className = 'placeholder';
            placeholder.textContent = 'Press the microphone to start speaking...';
            this.transcriptText.appendChild(placeholder);
        }
    }

    resetSilenceTimer() {
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
        }
    }

    startSilenceTimer() {
        this.resetSilenceTimer();

        this.silenceTimer = setTimeout(() => {
            if (this.finalTranscript.trim()) {
                this.processTranscript();
            }
        }, this.config.silenceThreshold);
    }

    async processTranscript() {
        if (!this.finalTranscript.trim() || this.isProcessing) return;

        const userMessage = this.finalTranscript.trim();
        this.finalTranscript = '';
        this.interimTranscript = '';

        // Stop listening while processing
        await this.stopListening();

        this.isProcessing = true;
        this.updateStatus('processing', 'Thinking...');
        this.voiceBtn.classList.add('processing');

        try {
            // Send to backend
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: userMessage,
                    history: this.conversationHistory
                })
            });

            if (!response.ok) {
                throw new Error('Chat request failed');
            }

            const data = await response.json();
            const assistantMessage = data.response;

            // Update conversation history
            this.conversationHistory.push(
                { role: 'user', content: userMessage },
                { role: 'assistant', content: assistantMessage }
            );

            // Keep history manageable
            if (this.conversationHistory.length > 20) {
                this.conversationHistory = this.conversationHistory.slice(-20);
            }

            // Display response safely using textContent
            this.responseText.textContent = assistantMessage;

            // Speak response
            await this.speakResponse(assistantMessage);

        } catch (error) {
            console.error('Processing error:', error);
            this.showError('Failed to get response');
        } finally {
            this.isProcessing = false;
            this.voiceBtn.classList.remove('processing');
        }
    }

    async speakResponse(text) {
        if (!text) return;

        this.isSpeaking = true;
        this.updateStatus('speaking', 'Speaking...');
        this.voiceBtn.classList.add('speaking');

        try {
            const response = await fetch('/api/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: text,
                    voice: this.config.selectedVoice,
                    speed: this.config.speechSpeed
                })
            });

            if (!response.ok) {
                throw new Error('TTS request failed');
            }

            const data = await response.json();

            if (data.audio_data) {
                await this.playAudio(data.audio_data);
            }

        } catch (error) {
            console.error('TTS error:', error);
            // Fallback to browser TTS
            await this.browserSpeak(text);
        } finally {
            this.isSpeaking = false;
            this.voiceBtn.classList.remove('speaking');
            this.updateStatus('', 'Ready');
        }
    }

    playAudio(base64Data) {
        return new Promise((resolve, reject) => {
            this.currentAudio = new Audio(`data:audio/mp3;base64,${base64Data}`);
            this.currentAudio.volume = 1.0;

            this.currentAudio.onended = () => {
                this.currentAudio = null;
                resolve();
            };

            this.currentAudio.onerror = (e) => {
                this.currentAudio = null;
                reject(e);
            };

            this.currentAudio.play().catch(reject);
        });
    }

    fadeOutAudio() {
        if (!this.currentAudio || this.currentAudio.paused) return;

        const audio = this.currentAudio;
        const fadeInterval = 20;
        const fadeSteps = 10;
        const volumeStep = audio.volume / fadeSteps;
        let step = 0;

        const fade = setInterval(() => {
            step++;
            audio.volume = Math.max(0, audio.volume - volumeStep);

            if (step >= fadeSteps || audio.volume <= 0) {
                clearInterval(fade);
                audio.pause();
                audio.currentTime = 0;
                this.currentAudio = null;
                this.isSpeaking = false;
                this.voiceBtn.classList.remove('speaking');
            }
        }, fadeInterval);
    }

    browserSpeak(text) {
        return new Promise((resolve, reject) => {
            if (!('speechSynthesis' in window)) {
                reject(new Error('Browser TTS not supported'));
                return;
            }

            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = this.config.speechSpeed;
            utterance.lang = 'en-US';

            utterance.onend = () => resolve();
            utterance.onerror = (e) => reject(e);

            window.speechSynthesis.speak(utterance);
        });
    }

    handleSpeechError(event) {
        if (event.error === 'no-speech') return;
        if (event.error !== 'aborted') {
            console.error('Speech recognition error:', event.error);
        }
    }

    handleRecognitionEnd() {
        if (this.isListening && !this.isProcessing) {
            // Restart recognition if still listening
            setTimeout(() => {
                if (this.isListening && this.recognition) {
                    try {
                        this.recognition.start();
                    } catch (e) {
                        if (e.name !== 'InvalidStateError') {
                            console.error('Error restarting recognition:', e);
                        }
                    }
                }
            }, 200);
        }
    }

    updateStatus(state, text) {
        this.statusIndicator.className = 'status-indicator ' + state;
        this.statusText.textContent = text;
    }

    showError(message) {
        this.updateStatus('error', message);
        setTimeout(() => {
            if (!this.isListening && !this.isProcessing && !this.isSpeaking) {
                this.updateStatus('', 'Ready');
            }
        }, 3000);
    }

    // Audio Visualization
    startVisualization() {
        const draw = () => {
            if (!this.analyser) {
                this.drawIdleVisualization();
                return;
            }

            this.animationId = requestAnimationFrame(draw);

            const bufferLength = this.analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            this.analyser.getByteFrequencyData(dataArray);

            this.drawVisualization(dataArray);
        };

        draw();
    }

    stopVisualization() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        this.drawIdleVisualization();
    }

    drawVisualization(dataArray) {
        const ctx = this.canvasCtx;
        const width = this.audioCanvas.width;
        const height = this.audioCanvas.height;

        // Clear canvas
        ctx.fillStyle = '#12121a';
        ctx.fillRect(0, 0, width, height);

        // Draw waveform
        const barCount = 64;
        const barWidth = width / barCount;
        const step = Math.floor(dataArray.length / barCount);

        for (let i = 0; i < barCount; i++) {
            const value = dataArray[i * step];
            const percent = value / 255;
            const barHeight = (height * 0.8) * percent;

            // Create gradient for each bar
            const gradient = ctx.createLinearGradient(0, height, 0, height - barHeight);
            gradient.addColorStop(0, '#4f46e5');
            gradient.addColorStop(0.5, '#6366f1');
            gradient.addColorStop(1, '#818cf8');

            ctx.fillStyle = gradient;

            // Draw mirrored bars (center out)
            const x = (width / 2) + (i - barCount / 2) * barWidth;
            const y = (height - barHeight) / 2;

            ctx.beginPath();
            ctx.roundRect(x + 1, y, barWidth - 2, barHeight, 2);
            ctx.fill();
        }

        // Add glow effect
        ctx.shadowBlur = 20;
        ctx.shadowColor = 'rgba(99, 102, 241, 0.5)';
    }

    drawIdleVisualization() {
        const ctx = this.canvasCtx;
        const width = this.audioCanvas.width;
        const height = this.audioCanvas.height;

        // Clear canvas
        ctx.fillStyle = '#12121a';
        ctx.fillRect(0, 0, width, height);

        // Draw subtle idle wave
        const time = Date.now() / 1000;
        const barCount = 64;
        const barWidth = width / barCount;

        for (let i = 0; i < barCount; i++) {
            const wave = Math.sin(time * 2 + i * 0.2) * 0.5 + 0.5;
            const barHeight = 4 + wave * 8;

            ctx.fillStyle = 'rgba(99, 102, 241, 0.3)';

            const x = (width / 2) + (i - barCount / 2) * barWidth;
            const y = (height - barHeight) / 2;

            ctx.beginPath();
            ctx.roundRect(x + 1, y, barWidth - 2, barHeight, 2);
            ctx.fill();
        }

        // Continue animation
        if (!this.isListening) {
            requestAnimationFrame(() => this.drawIdleVisualization());
        }
    }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    window.voiceAssistant = new VoiceAssistant();
});
