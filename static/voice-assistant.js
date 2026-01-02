/**
 * Voice Assistant - Client-side JavaScript
 * Handles speech recognition, audio visualization, and API communication
 */

class VoiceAssistant {
    constructor() {
        // DOM Elements
        this.voiceCircle = document.getElementById('voiceCircle');
        this.statusText = document.getElementById('statusText');
        this.displayContent = document.getElementById('displayContent');
        this.settingsBtn = document.getElementById('settingsBtn');
        this.settingsPanel = document.getElementById('settingsPanel');
        this.closeSettings = document.getElementById('closeSettings');
        this.voiceSelect = document.getElementById('voiceSelect');
        this.modelSelect = document.getElementById('modelSelect');
        this.speedRange = document.getElementById('speedRange');
        this.speedValue = document.getElementById('speedValue');
        this.ollamaStatus = document.getElementById('ollamaStatus');
        this.kokoroStatus = document.getElementById('kokoroStatus');

        // State
        this.isListening = false;
        this.isProcessing = false;
        this.isSpeaking = false;
        this.recognition = null;
        this.audioContext = null;
        this.analyser = null;
        this.mediaStream = null;
        this.currentAudio = null;
        this.conversationHistory = [];

        // Transcript state
        this.interimTranscript = '';
        this.finalTranscript = '';
        this.silenceTimer = null;

        // Configuration
        this.config = {
            silenceThreshold: 2000,
            selectedVoice: 'af_heart',
            selectedModel: 'llama3.2:latest',
            speechSpeed: 1.0
        };

        // Initialize
        this.init();
    }

    async init() {
        // Set up event listeners
        this.voiceCircle.addEventListener('click', () => this.toggleListening());
        this.settingsBtn.addEventListener('click', () => this.openSettings());
        this.closeSettings.addEventListener('click', () => this.closeSettingsPanel());
        this.speedRange.addEventListener('input', (e) => this.updateSpeed(e.target.value));

        // Close settings when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.settingsPanel.contains(e.target) && !this.settingsBtn.contains(e.target)) {
                this.closeSettingsPanel();
            }
        });

        // Load settings
        await this.loadSettings();

        // Check service health
        await this.checkHealth();
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
        while (this.voiceSelect.firstChild) {
            this.voiceSelect.removeChild(this.voiceSelect.firstChild);
        }

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

    openSettings() {
        this.settingsPanel.classList.add('open');
        this.settingsBtn.style.display = 'none';
    }

    closeSettingsPanel() {
        this.settingsPanel.classList.remove('open');
        this.settingsBtn.style.display = 'flex';
    }

    async checkHealth() {
        try {
            const res = await fetch('/api/health');
            const data = await res.json();

            this.ollamaStatus.className = 'status-dot ' +
                (data.services.ollama === 'healthy' ? 'healthy' : 'unhealthy');
            this.kokoroStatus.className = 'status-dot ' +
                (data.services.kokoro === 'healthy' ? 'healthy' : 'unhealthy');
        } catch (error) {
            console.error('Health check failed:', error);
        }
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
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition) {
                this.showError('Speech recognition not supported');
                return;
            }

            // Request microphone access
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // Set up audio context for level monitoring
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;

            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            source.connect(this.analyser);

            // Start audio level monitoring
            this.monitorAudioLevel();

            // Set up speech recognition
            this.recognition = new SpeechRecognition();
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.lang = 'en-US';

            this.recognition.onstart = () => {
                this.isListening = true;
                this.updateUI('listening');
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

    monitorAudioLevel() {
        if (!this.analyser || !this.isListening) return;

        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(dataArray);

        // Calculate RMS
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / dataArray.length) / 255;

        // Update has-audio class based on audio level
        if (rms > 0.05) {
            this.voiceCircle.classList.add('has-audio');
        } else {
            this.voiceCircle.classList.remove('has-audio');
        }

        requestAnimationFrame(() => this.monitorAudioLevel());
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

        this.voiceCircle.classList.remove('recording', 'has-audio');

        if (!this.isProcessing && !this.isSpeaking) {
            this.updateUI('idle');
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

        // Barge-in detection
        if ((currentInterim || currentFinal) && this.isSpeaking && this.currentAudio) {
            this.fadeOutAudio();
        }

        if (currentInterim) {
            this.interimTranscript = currentInterim;
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
        while (this.displayContent.firstChild) {
            this.displayContent.removeChild(this.displayContent.firstChild);
        }

        if (this.finalTranscript || this.interimTranscript) {
            const userDiv = document.createElement('div');
            userDiv.className = 'user-text';
            userDiv.textContent = this.finalTranscript;

            if (this.interimTranscript) {
                const interimSpan = document.createElement('span');
                interimSpan.className = 'interim';
                interimSpan.textContent = this.interimTranscript;
                userDiv.appendChild(interimSpan);
            }

            this.displayContent.appendChild(userDiv);
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

        await this.stopListening();

        this.isProcessing = true;
        this.updateUI('processing');

        try {
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

            if (this.conversationHistory.length > 20) {
                this.conversationHistory = this.conversationHistory.slice(-20);
            }

            // Display response
            this.displayResponse(userMessage, assistantMessage);

            // Speak response
            await this.speakResponse(assistantMessage);

        } catch (error) {
            console.error('Processing error:', error);
            this.showError('Failed to get response');
        } finally {
            this.isProcessing = false;
            this.voiceCircle.classList.remove('processing');
        }
    }

    displayResponse(userText, assistantText) {
        while (this.displayContent.firstChild) {
            this.displayContent.removeChild(this.displayContent.firstChild);
        }

        const userDiv = document.createElement('div');
        userDiv.className = 'user-text';
        userDiv.textContent = userText;

        const assistantDiv = document.createElement('div');
        assistantDiv.className = 'assistant-text';
        assistantDiv.textContent = assistantText;

        this.displayContent.appendChild(userDiv);
        this.displayContent.appendChild(assistantDiv);
    }

    async speakResponse(text) {
        if (!text) return;

        this.isSpeaking = true;
        this.updateUI('speaking');

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
            await this.browserSpeak(text);
        } finally {
            this.isSpeaking = false;
            this.voiceCircle.classList.remove('speaking');
            this.updateUI('idle');
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
        const fadeSteps = 10;
        const volumeStep = audio.volume / fadeSteps;
        let step = 0;

        const fade = setInterval(() => {
            step++;
            audio.volume = Math.max(0, audio.volume - volumeStep);

            if (step >= fadeSteps || audio.volume <= 0) {
                clearInterval(fade);
                audio.pause();
                this.currentAudio = null;
                this.isSpeaking = false;
                this.voiceCircle.classList.remove('speaking');
            }
        }, 20);
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

    updateUI(state) {
        // Remove all state classes
        this.voiceCircle.classList.remove('recording', 'processing', 'speaking');
        this.statusText.classList.remove('recording', 'processing', 'speaking');

        switch (state) {
            case 'listening':
                this.voiceCircle.classList.add('recording');
                this.statusText.classList.add('recording');
                this.statusText.textContent = 'Listening...';
                break;
            case 'processing':
                this.voiceCircle.classList.add('processing');
                this.statusText.classList.add('processing');
                this.statusText.textContent = 'Thinking...';
                break;
            case 'speaking':
                this.voiceCircle.classList.add('speaking');
                this.statusText.classList.add('speaking');
                this.statusText.textContent = 'Speaking...';
                break;
            default:
                this.statusText.textContent = 'Tap to speak';
        }
    }

    showError(message) {
        this.statusText.textContent = message;
        this.statusText.classList.add('error');
        setTimeout(() => {
            this.statusText.classList.remove('error');
            this.updateUI('idle');
        }, 3000);
    }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    window.voiceAssistant = new VoiceAssistant();
});
