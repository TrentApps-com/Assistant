/**
 * Voice Assistant - YourStory Interview Style
 * Uses the exact same waveform visualization from YourStory/FormFlow
 */

// Configuration
const VOICE_CONFIG = {
    SILENCE_THRESHOLD: 2500,        // Process after 2.5s silence
    THINKING_INDICATOR_DELAY: 1500, // Show "Still listening" after 1.5s
    POST_AI_SPEECH_DELAY: 800,      // Wait before listening again
    MIN_SPEECH_LENGTH: 500          // Minimum speech to process
};

// State
const state = {
    isActive: false,
    isListening: false,
    isSpeaking: false,
    isProcessing: false,
    isMuted: false, // Microphone mute state
    isAuthenticated: false,
    recognition: null,
    conversationHistory: [],
    currentTranscript: '',
    finalTranscript: '',
    aiAudio: null,
    silenceTimer: null,
    thinkingTimer: null,
    speechStartTime: null,
    selectedVoice: 'af_heart',
    selectedModel: 'llama3.2:latest',
    speechSpeed: 1.0,
    notifications: [],
    unreadCount: 0,
    notificationPollInterval: null
};

// DOM Elements
const elements = {};

// Waveform visualization variables (FormFlow style)
let waveformAnimationId = null;
let waveformAudioContext = null;
let waveformAnalyser = null;
let waveformAudioStream = null;

// Multiple curves with different attenuation (Siri-style)
const curves = [
    { attenuation: -3, opacity: 0.25, lineWidth: 1.5 },
    { attenuation: -2, opacity: 0.1, lineWidth: 1 },
    { attenuation: -1, opacity: 0.2, lineWidth: 1 },
    { attenuation: 0, opacity: 0.4, lineWidth: 1.5 },
    { attenuation: 1, opacity: 0.6, lineWidth: 2 },
    { attenuation: 2, opacity: 1, lineWidth: 3.5 },
    { attenuation: 3, opacity: 0.35, lineWidth: 2 }
];

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    // Cache DOM elements
    elements.voiceAvatarContainer = document.getElementById('voiceAvatarContainer');
    elements.voiceAvatarCircle = document.getElementById('voiceAvatarCircle');
    elements.voiceWaveform = document.getElementById('voiceWaveform');
    elements.interviewCurrentText = document.getElementById('interviewCurrentText');
    elements.settingsBtn = document.getElementById('settingsBtn');
    elements.settingsPanel = document.getElementById('settingsPanel');
    elements.closeSettings = document.getElementById('closeSettings');
    elements.voiceSelect = document.getElementById('voiceSelect');
    elements.modelSelect = document.getElementById('modelSelect');
    elements.speedRange = document.getElementById('speedRange');
    elements.speedValue = document.getElementById('speedValue');
    elements.ollamaStatus = document.getElementById('ollamaStatus');
    elements.kokoroStatus = document.getElementById('kokoroStatus');
    elements.muteBtn = document.getElementById('muteBtn');
    elements.micOnIcon = document.getElementById('micOnIcon');
    elements.micOffIcon = document.getElementById('micOffIcon');

    // Login elements
    elements.loginOverlay = document.getElementById('loginOverlay');
    elements.loginForm = document.getElementById('loginForm');
    elements.loginPassword = document.getElementById('loginPassword');
    elements.loginError = document.getElementById('loginError');

    // Notification elements
    elements.notificationBtn = document.getElementById('notificationBtn');
    elements.notificationBadge = document.getElementById('notificationBadge');
    elements.notificationPanel = document.getElementById('notificationPanel');
    elements.notificationList = document.getElementById('notificationList');
    elements.closeNotifications = document.getElementById('closeNotifications');
    elements.markAllReadBtn = document.getElementById('markAllReadBtn');

    // Set up event listeners
    elements.voiceAvatarContainer.addEventListener('click', toggleVoiceMode);
    elements.settingsBtn.addEventListener('click', openSettings);
    elements.closeSettings.addEventListener('click', closeSettings);
    elements.speedRange.addEventListener('input', updateSpeed);
    elements.muteBtn.addEventListener('click', toggleMute);

    // Login event listeners
    elements.loginForm.addEventListener('submit', handleLogin);

    // Notification event listeners
    elements.notificationBtn.addEventListener('click', toggleNotificationPanel);
    elements.closeNotifications.addEventListener('click', closeNotificationPanel);
    elements.markAllReadBtn.addEventListener('click', markAllNotificationsRead);

    // Close panels when clicking outside
    document.addEventListener('click', (e) => {
        if (!elements.settingsPanel.contains(e.target) && !elements.settingsBtn.contains(e.target)) {
            closeSettings();
        }
        if (!elements.notificationPanel.contains(e.target) && !elements.notificationBtn.contains(e.target)) {
            closeNotificationPanel();
        }
    });

    // Check authentication status first
    checkAuthStatus();

    // Load settings and check health
    loadSettings();
    checkHealth();
});

function setAvatarState(avatarState) {
    elements.voiceAvatarContainer.classList.remove('listening', 'speaking', 'thinking');
    if (avatarState) elements.voiceAvatarContainer.classList.add(avatarState);

    // Update WebGL orb state if available
    if (window.neonOrb) {
        window.neonOrb.setState(avatarState || 'idle');
    }
}

function showCurrentText(text, faded = false) {
    elements.interviewCurrentText.textContent = text;
    elements.interviewCurrentText.classList.toggle('faded', faded);
    // Auto-scroll to bottom for long text
    elements.interviewCurrentText.scrollTop = elements.interviewCurrentText.scrollHeight;
}

function updateInterimTranscript(text) {
    showCurrentText(text || '...', true);
}

// Start idle waveform animation
function startIdleWaveform() {
    const canvas = elements.voiceWaveform;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const maxWaveHeight = 1; // Nearly flat at rest
    let phase = 0;

    function draw() {
        if (!state.isActive) return;
        waveformAnimationId = requestAnimationFrame(draw);
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Get current state color (matching logo neon colors)
        let baseColor = { r: 124, g: 185, b: 232 }; // Logo blue neon #7CB9E8 for idle
        if (elements.voiceAvatarContainer.classList.contains('listening')) {
            baseColor = { r: 124, g: 185, b: 232 }; // Logo blue neon #7CB9E8
        } else if (elements.voiceAvatarContainer.classList.contains('speaking')) {
            baseColor = { r: 255, g: 179, b: 71 }; // Logo orange #FFB347
        } else if (elements.voiceAvatarContainer.classList.contains('thinking')) {
            baseColor = { r: 190, g: 182, b: 152 }; // Mixed blue-orange
        }

        // Draw multiple curves for depth
        curves.forEach(curve => {
            ctx.beginPath();
            ctx.lineWidth = curve.lineWidth;
            ctx.strokeStyle = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${curve.opacity})`;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            const waveWidth = canvas.width;
            const frequency = 1;

            for (let x = 0; x <= waveWidth; x++) {
                const normalizedX = x / waveWidth;
                const angle = normalizedX * Math.PI * 2 * frequency + phase + (curve.attenuation * 0.1);

                // Center-biased amplitude envelope
                const distanceFromCenter = Math.abs(x - centerX) / (waveWidth / 2);
                const centerBoost = 1.8;
                const amplitudeEnvelope = (1 - Math.pow(distanceFromCenter, 1.5)) * centerBoost;

                const y = centerY + Math.sin(angle) * maxWaveHeight * (1 + curve.attenuation * 0.1) * amplitudeEnvelope;

                if (x === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }

            ctx.stroke();
        });

        phase += 0.02;
    }

    draw();
}

// Start waveform visualization with microphone input
function startWaveformVisualization(stream) {
    const canvas = elements.voiceWaveform;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const maxWaveHeight = 20;
    let phase = 0;
    let smoothedAmplitude = 0;

    // Set up audio context and analyser
    waveformAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    waveformAnalyser = waveformAudioContext.createAnalyser();
    const source = waveformAudioContext.createMediaStreamSource(stream);
    source.connect(waveformAnalyser);
    waveformAnalyser.fftSize = 256;
    waveformAnalyser.smoothingTimeConstant = 0.7;
    const bufferLength = waveformAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
        if (!state.isActive) return;
        waveformAnimationId = requestAnimationFrame(draw);
        waveformAnalyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
        }
        const average = sum / bufferLength;
        const normalizedAmplitude = average / 255;

        smoothedAmplitude += (normalizedAmplitude - smoothedAmplitude) * 0.35;

        // Update WebGL orb audio level if available
        if (window.neonOrb) {
            window.neonOrb.setAudioLevel(smoothedAmplitude);
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        let baseColor = { r: 124, g: 185, b: 232 }; // Logo blue neon #7CB9E8 for listening

        const waveFrequency = 1 + (smoothedAmplitude * 9);
        const amplitude = smoothedAmplitude > 0.03 ? maxWaveHeight * smoothedAmplitude : 1;

        curves.forEach(curve => {
            ctx.beginPath();
            ctx.lineWidth = curve.lineWidth;
            ctx.strokeStyle = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${curve.opacity})`;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            const waveWidth = canvas.width;

            for (let x = 0; x <= waveWidth; x++) {
                const normalizedX = x / waveWidth;
                const angle = normalizedX * Math.PI * 2 * waveFrequency + phase + (curve.attenuation * 0.15);

                const distanceFromCenter = Math.abs(x - centerX) / (waveWidth / 2);
                const centerBoost = 1.8;
                const amplitudeEnvelope = (1 - Math.pow(distanceFromCenter, 1.5)) * centerBoost;

                const y = centerY + Math.sin(angle) * amplitude * (1 + curve.attenuation * 0.15) * amplitudeEnvelope;

                if (x === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }

            ctx.stroke();
        });

        phase += 0.08;
    }

    draw();
}

// Visualize audio output from assistant speaking
function startSpeakingWaveform(audioElement) {
    const canvas = elements.voiceWaveform;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const maxWaveHeight = 20;
    let phase = 0;
    let smoothedAmplitude = 0;

    const speakingCurves = [
        { attenuation: -3, opacity: 0.08, lineWidth: 0.8 },
        { attenuation: -2, opacity: 0.1, lineWidth: 1 },
        { attenuation: -1, opacity: 0.2, lineWidth: 1 },
        { attenuation: 0, opacity: 0.4, lineWidth: 1.5 },
        { attenuation: 1, opacity: 0.6, lineWidth: 2 },
        { attenuation: 2, opacity: 1, lineWidth: 3.5 },
        { attenuation: 3, opacity: 0.15, lineWidth: 1.2 }
    ];

    // Create audio context and analyser for the audio element
    if (!waveformAudioContext) {
        waveformAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    waveformAnalyser = waveformAudioContext.createAnalyser();
    const source = waveformAudioContext.createMediaElementSource(audioElement);
    source.connect(waveformAnalyser);
    waveformAnalyser.connect(waveformAudioContext.destination);
    waveformAnalyser.fftSize = 256;
    waveformAnalyser.smoothingTimeConstant = 0.7;
    const bufferLength = waveformAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
        if (!state.isActive) return;
        waveformAnimationId = requestAnimationFrame(draw);
        waveformAnalyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
        }
        const average = sum / bufferLength;
        const normalizedAmplitude = average / 255;

        smoothedAmplitude += (normalizedAmplitude - smoothedAmplitude) * 0.35;

        // Update WebGL orb audio level if available
        if (window.neonOrb) {
            window.neonOrb.setAudioLevel(smoothedAmplitude);
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        let baseColor = { r: 255, g: 179, b: 71 }; // Logo orange #FFB347 for speaking

        const waveFrequency = 1 + (smoothedAmplitude * 9);
        const amplitude = smoothedAmplitude > 0.03 ? maxWaveHeight * smoothedAmplitude : 1;

        speakingCurves.forEach(curve => {
            ctx.beginPath();
            ctx.lineWidth = curve.lineWidth;
            ctx.strokeStyle = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${curve.opacity})`;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            const waveWidth = canvas.width;

            for (let x = 0; x <= waveWidth; x++) {
                const normalizedX = x / waveWidth;
                const angle = normalizedX * Math.PI * 2 * waveFrequency + phase + (curve.attenuation * 0.15);

                const distanceFromCenter = Math.abs(x - centerX) / (waveWidth / 2);
                const centerBoost = 1.8;
                const amplitudeEnvelope = (1 - Math.pow(distanceFromCenter, 1.5)) * centerBoost;

                const y = centerY + Math.sin(angle) * amplitude * (1 + curve.attenuation * 0.15) * amplitudeEnvelope;

                if (x === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }

            ctx.stroke();
        });

        phase += 0.08;
    }

    draw();
}

function stopWaveformVisualization() {
    if (waveformAnimationId) {
        cancelAnimationFrame(waveformAnimationId);
        waveformAnimationId = null;
    }
    if (waveformAudioContext) {
        waveformAudioContext.close();
        waveformAudioContext = null;
    }
    if (waveformAudioStream) {
        waveformAudioStream.getTracks().forEach(track => track.stop());
        waveformAudioStream = null;
    }
    const canvas = elements.voiceWaveform;
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
}

// Pause waveform visualization without stopping the mic stream
function pauseWaveformVisualization() {
    if (waveformAnimationId) {
        cancelAnimationFrame(waveformAnimationId);
        waveformAnimationId = null;
    }
    if (waveformAudioContext) {
        waveformAudioContext.close();
        waveformAudioContext = null;
    }
    const canvas = elements.voiceWaveform;
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
}

// Release microphone stream
function releaseMicrophoneStream() {
    if (waveformAudioStream) {
        waveformAudioStream.getTracks().forEach(track => track.stop());
        waveformAudioStream = null;
    }
}

// Toggle voice mode on/off
async function toggleVoiceMode() {
    if (state.isActive) {
        stopVoiceMode();
    } else {
        await startVoiceMode();
    }
}

// Update mute button visual based on mute state only
function updateMuteButtonVisual() {
    // Show muted appearance ONLY when manually muted
    // Not based on listening state - that's confusing
    elements.muteBtn.classList.toggle('muted', state.isMuted);
    elements.micOnIcon.style.display = state.isMuted ? 'none' : 'block';
    elements.micOffIcon.style.display = state.isMuted ? 'block' : 'none';
}

// Toggle microphone mute - completely stops all mic input when muted
// Does NOT interrupt ongoing AI processing or speaking
function toggleMute() {
    state.isMuted = !state.isMuted;
    updateMuteButtonVisual();

    if (state.isMuted) {
        // MUTED - stop microphone input only
        // DON'T interrupt ongoing AI processing or speaking
        // DON'T stop audio output

        // Stop speech recognition
        if (state.recognition) {
            try { state.recognition.stop(); } catch (e) {}
            state.recognition = null;
        }
        state.isListening = false;

        // Stop and release the microphone audio stream
        if (waveformAudioStream) {
            waveformAudioStream.getTracks().forEach(track => track.stop());
            waveformAudioStream = null;
        }

        // Clear listening timers but NOT processing
        clearTimeout(state.silenceTimer);
        clearTimeout(state.thinkingTimer);

        // Only change display if not currently processing/speaking
        if (!state.isProcessing && !state.isSpeaking) {
            // Stop mic waveform visualization only if not speaking
            stopWaveformVisualization();
            setAvatarState('idle');
            showCurrentText('Microphone muted', true);
        }
        // If speaking, let audio continue - don't touch audio context

    } else {
        // UNMUTED - update visual immediately
        showCurrentText('Tap the circle to start speaking');
        setAvatarState('idle');

        // If voice mode is active and not busy, re-acquire mic and resume
        if (state.isActive && !state.isSpeaking && !state.isProcessing) {
            navigator.mediaDevices.getUserMedia({ audio: true })
                .then(stream => {
                    waveformAudioStream = stream;
                    startIdleWaveform();
                    startListening();
                })
                .catch(err => {
                    console.error('Failed to re-acquire microphone:', err);
                    showCurrentText('Microphone access denied');
                });
        }
        // If not active or busy, just show unmuted state - user can tap orb to start
    }
}

// Start voice mode
async function startVoiceMode() {
    try {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            showCurrentText('Speech recognition not supported');
            return;
        }

        state.isActive = true;
        state.conversationHistory = [];

        // If muted, don't request microphone - just show muted state
        if (state.isMuted) {
            showCurrentText('Microphone muted', true);
            setAvatarState('idle');
            return;
        }

        // Request microphone access
        waveformAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true });

        // Start idle waveform
        startIdleWaveform();

        // Start listening
        startListening();

    } catch (error) {
        console.error('Failed to start voice mode:', error);
        showCurrentText('Microphone access denied');
    }
}

// Stop voice mode
function stopVoiceMode() {
    state.isActive = false;
    state.isListening = false;
    state.isProcessing = false;
    state.isSpeaking = false;
    updateMuteButtonVisual();

    if (state.recognition) {
        try { state.recognition.stop(); } catch (e) {}
        state.recognition = null;
    }

    if (state.aiAudio) {
        state.aiAudio.pause();
        state.aiAudio = null;
    }

    clearTimeout(state.silenceTimer);
    clearTimeout(state.thinkingTimer);

    stopWaveformVisualization();
    releaseMicrophoneStream();
    setAvatarState(null);
    showCurrentText('Tap the circle to start speaking');
}

// Start listening
function startListening() {
    if (!state.isActive || state.isListening || state.isSpeaking || state.isMuted) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    state.recognition = new SpeechRecognition();
    state.recognition.continuous = true;
    state.recognition.interimResults = true;
    state.recognition.lang = 'en-US';

    state.recognition.onstart = () => {
        state.isListening = true;
        updateMuteButtonVisual();
        setAvatarState('listening');
        showCurrentText('Listening...', true);
        state.finalTranscript = '';
        state.currentTranscript = '';

        // Start microphone waveform visualization
        if (waveformAudioStream) {
            startWaveformVisualization(waveformAudioStream);
        }
    };

    state.recognition.onresult = (event) => {
        let interim = '';
        let final = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            if (result.isFinal) {
                final += result[0].transcript;
            } else {
                interim += result[0].transcript;
            }
        }

        // Barge-in detection - interrupt AI if user starts speaking
        if ((interim || final) && state.isSpeaking && state.aiAudio) {
            fadeOutAudio();
        }

        if (interim) {
            state.currentTranscript = interim;
            updateInterimTranscript(state.finalTranscript + interim);
            resetSilenceTimer();
        }

        if (final) {
            state.finalTranscript += final;
            state.currentTranscript = '';
            showCurrentText(state.finalTranscript, false);
            startSilenceTimer();
        }
    };

    state.recognition.onerror = (event) => {
        if (event.error === 'no-speech') return;
        if (event.error !== 'aborted') {
            console.error('Speech recognition error:', event.error);
        }
    };

    state.recognition.onend = () => {
        // Auto-restart if still active and not processing/speaking
        if (state.isActive && state.isListening && !state.isProcessing && !state.isSpeaking) {
            setTimeout(() => {
                if (state.isActive && !state.isProcessing && !state.isSpeaking) {
                    try {
                        state.recognition.start();
                    } catch (e) {
                        if (e.name !== 'InvalidStateError') {
                            console.error('Error restarting recognition:', e);
                        }
                    }
                }
            }, 200);
        }
    };

    state.recognition.start();
}

function resetSilenceTimer() {
    clearTimeout(state.silenceTimer);
    clearTimeout(state.thinkingTimer);
}

function startSilenceTimer() {
    resetSilenceTimer();

    state.silenceTimer = setTimeout(() => {
        if (state.finalTranscript.trim() && state.finalTranscript.length >= VOICE_CONFIG.MIN_SPEECH_LENGTH / 100) {
            processTranscript();
        }
    }, VOICE_CONFIG.SILENCE_THRESHOLD);
}

async function processTranscript() {
    if (!state.finalTranscript.trim() || state.isProcessing) return;

    const userMessage = state.finalTranscript.trim();
    state.finalTranscript = '';
    state.currentTranscript = '';

    // Stop listening while processing
    state.isListening = false;
    updateMuteButtonVisual();
    if (state.recognition) {
        try { state.recognition.stop(); } catch (e) {}
    }
    pauseWaveformVisualization();

    state.isProcessing = true;
    setAvatarState('thinking');
    showCurrentText('Thinking...', true);

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: userMessage,
                history: state.conversationHistory
            })
        });

        if (!response.ok) {
            throw new Error('Chat request failed');
        }

        const data = await response.json();
        let assistantMessage = data.response;

        // Check if the response is a function call
        const functionCall = detectFunctionCall(assistantMessage);
        if (functionCall) {
            // Execute the function call and get a human-readable response
            const functionResponse = await executeFunctionCall(functionCall);

            // Update conversation with function execution info
            state.conversationHistory.push(
                { role: 'user', content: userMessage },
                { role: 'assistant', content: `[Function: ${functionCall.function}] ${functionResponse}` }
            );

            // Speak the function response
            showCurrentText(functionResponse, false);
            await speakResponse(functionResponse);
            return;
        }

        // Update conversation history
        state.conversationHistory.push(
            { role: 'user', content: userMessage },
            { role: 'assistant', content: assistantMessage }
        );

        // Keep history manageable
        if (state.conversationHistory.length > 20) {
            state.conversationHistory = state.conversationHistory.slice(-20);
        }

        // Show and speak response
        showCurrentText(assistantMessage, false);
        await speakResponse(assistantMessage);

    } catch (error) {
        console.error('Processing error:', error);
        showCurrentText('Failed to get response');
        state.isProcessing = false;

        // Restart listening after error (respecting mute state)
        if (state.isActive && !state.isMuted) {
            setTimeout(() => startListening(), VOICE_CONFIG.POST_AI_SPEECH_DELAY);
        } else if (state.isMuted) {
            setAvatarState('idle');
            showCurrentText('Microphone muted', true);
        }
    }
}

async function speakResponse(text) {
    if (!text) return;

    state.isSpeaking = true;
    state.isProcessing = false;
    setAvatarState('speaking');

    try {
        const response = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: text,
                voice: state.selectedVoice,
                speed: state.speechSpeed
            })
        });

        if (!response.ok) {
            throw new Error('TTS request failed');
        }

        const data = await response.json();

        if (data.audio_data) {
            await playAudio(data.audio_data);
        }

    } catch (error) {
        console.error('TTS error:', error);
        // Fallback to browser TTS
        await browserSpeak(text);
    } finally {
        state.isSpeaking = false;

        // Only restart mic-related things if not muted
        if (!state.isMuted) {
            startIdleWaveform();
            // Auto-restart listening after speaking
            if (state.isActive) {
                // Re-acquire mic if it was released
                if (!waveformAudioStream) {
                    navigator.mediaDevices.getUserMedia({ audio: true })
                        .then(stream => {
                            waveformAudioStream = stream;
                            startIdleWaveform();
                            setTimeout(() => startListening(), VOICE_CONFIG.POST_AI_SPEECH_DELAY);
                        })
                        .catch(err => console.error('Failed to re-acquire mic:', err));
                } else {
                    setTimeout(() => startListening(), VOICE_CONFIG.POST_AI_SPEECH_DELAY);
                }
            }
        } else {
            // Muted - just show muted state
            setAvatarState('idle');
            showCurrentText('Microphone muted', true);
        }
    }
}

function playAudio(base64Data) {
    return new Promise((resolve) => {
        const audio = new Audio(`data:audio/mp3;base64,${base64Data}`);
        state.aiAudio = audio;
        audio.volume = 1.0;

        audio.onplay = () => {
            startSpeakingWaveform(audio);
        };

        audio.onended = () => {
            state.aiAudio = null;
            resolve();
        };

        audio.onerror = () => {
            state.aiAudio = null;
            resolve();
        };

        audio.play().catch(() => resolve());
    });
}

function fadeOutAudio() {
    if (!state.aiAudio || state.aiAudio.paused) return;

    const audio = state.aiAudio;
    const fadeSteps = 10;
    const volumeStep = audio.volume / fadeSteps;
    let step = 0;

    const fade = setInterval(() => {
        step++;
        audio.volume = Math.max(0, audio.volume - volumeStep);

        if (step >= fadeSteps || audio.volume <= 0) {
            clearInterval(fade);
            audio.pause();
            state.aiAudio = null;
            state.isSpeaking = false;
            setAvatarState('listening');
            startIdleWaveform();
        }
    }, 20);
}

function browserSpeak(text) {
    return new Promise((resolve) => {
        if (!('speechSynthesis' in window)) {
            resolve();
            return;
        }

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = state.speechSpeed;
        utterance.lang = 'en-US';

        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();

        window.speechSynthesis.speak(utterance);
    });
}

// Settings functions
const STORAGE_KEY = 'voiceAssistantSettings';

function saveSettingsToStorage() {
    const settings = {
        selectedVoice: state.selectedVoice,
        selectedModel: state.selectedModel,
        speechSpeed: state.speechSpeed
    };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
        console.warn('Failed to save settings to localStorage:', e);
    }
}

function loadSettingsFromStorage() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const settings = JSON.parse(stored);
            if (settings.selectedVoice) state.selectedVoice = settings.selectedVoice;
            if (settings.selectedModel) state.selectedModel = settings.selectedModel;
            if (settings.speechSpeed) state.speechSpeed = settings.speechSpeed;

            // Update UI for speed
            if (elements.speedRange && elements.speedValue) {
                elements.speedRange.value = state.speechSpeed;
                elements.speedValue.textContent = `${state.speechSpeed}x`;
            }
        }
    } catch (e) {
        console.warn('Failed to load settings from localStorage:', e);
    }
}

async function loadSettings() {
    // First load any saved settings from localStorage
    loadSettingsFromStorage();

    try {
        // Load voices from API
        const voicesRes = await fetch('/api/voices');
        if (voicesRes.ok) {
            const data = await voicesRes.json();
            populateVoices(data.voices || []);
        }

        // Load models from API
        const modelsRes = await fetch('/api/models');
        if (modelsRes.ok) {
            const data = await modelsRes.json();
            populateModels(data.models || []);
        }
    } catch (error) {
        console.error('Failed to load settings:', error);
    }
}

function populateVoices(voices) {
    while (elements.voiceSelect.firstChild) {
        elements.voiceSelect.removeChild(elements.voiceSelect.firstChild);
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
            if (voice === state.selectedVoice) {
                option.selected = true;
            }
            optgroup.appendChild(option);
        }

        elements.voiceSelect.appendChild(optgroup);
    }

    elements.voiceSelect.addEventListener('change', (e) => {
        state.selectedVoice = e.target.value;
        saveSettingsToStorage();
    });
}

function populateModels(models) {
    while (elements.modelSelect.firstChild) {
        elements.modelSelect.removeChild(elements.modelSelect.firstChild);
    }

    for (const model of models) {
        const option = document.createElement('option');
        option.value = model.name;
        const sizeGB = (model.size / (1024 * 1024 * 1024)).toFixed(1);
        option.textContent = `${model.name} (${sizeGB}GB)`;
        if (model.name === state.selectedModel) {
            option.selected = true;
        }
        elements.modelSelect.appendChild(option);
    }

    elements.modelSelect.addEventListener('change', (e) => {
        state.selectedModel = e.target.value;
        saveSettingsToStorage();
    });
}

function updateSpeed(e) {
    state.speechSpeed = parseFloat(e.target.value);
    elements.speedValue.textContent = `${e.target.value}x`;
    saveSettingsToStorage();
}

function openSettings() {
    elements.settingsPanel.classList.add('open');
    elements.settingsBtn.style.display = 'none';
}

function closeSettings() {
    elements.settingsPanel.classList.remove('open');
    elements.settingsBtn.style.display = 'flex';
}

async function checkHealth() {
    try {
        const res = await fetch('/api/health');
        const data = await res.json();

        elements.ollamaStatus.className = 'status-dot ' +
            (data.services.ollama === 'healthy' ? 'healthy' : 'unhealthy');
        elements.kokoroStatus.className = 'status-dot ' +
            (data.services.kokoro === 'healthy' ? 'healthy' : 'unhealthy');
    } catch (error) {
        console.error('Health check failed:', error);
    }
}

// ============ Authentication Functions ============

async function checkAuthStatus() {
    try {
        const res = await fetch('/api/auth/status', { credentials: 'include' });
        const data = await res.json();

        if (data.authenticated) {
            state.isAuthenticated = true;
            elements.loginOverlay.classList.add('hidden');
            startNotificationPolling();
        } else {
            state.isAuthenticated = false;
            elements.loginOverlay.classList.remove('hidden');
        }
    } catch (error) {
        console.error('Auth status check failed:', error);
        elements.loginOverlay.classList.remove('hidden');
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const password = elements.loginPassword.value;

    if (!password) {
        elements.loginError.textContent = 'Please enter a password';
        return;
    }

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ password })
        });

        const data = await res.json();

        if (res.ok && data.success) {
            state.isAuthenticated = true;
            elements.loginOverlay.classList.add('hidden');
            elements.loginError.textContent = '';
            elements.loginPassword.value = '';
            startNotificationPolling();
        } else {
            elements.loginError.textContent = data.error || 'Login failed';
        }
    } catch (error) {
        console.error('Login error:', error);
        elements.loginError.textContent = 'Connection error. Please try again.';
    }
}

// ============ Notification Functions ============

function startNotificationPolling() {
    // Initial fetch
    fetchNotifications();
    // Poll every 10 seconds
    state.notificationPollInterval = setInterval(fetchNotifications, 10000);
}

function stopNotificationPolling() {
    if (state.notificationPollInterval) {
        clearInterval(state.notificationPollInterval);
        state.notificationPollInterval = null;
    }
}

async function fetchNotifications() {
    try {
        const res = await fetch('/api/notifications', { credentials: 'include' });
        const data = await res.json();

        state.notifications = data.notifications || [];
        state.unreadCount = data.unread_count || 0;
        updateNotificationBadge();
        renderNotifications();
    } catch (error) {
        console.error('Failed to fetch notifications:', error);
    }
}

function updateNotificationBadge() {
    if (state.unreadCount > 0) {
        elements.notificationBadge.textContent = state.unreadCount > 99 ? '99+' : state.unreadCount;
        elements.notificationBadge.style.display = 'flex';
    } else {
        elements.notificationBadge.style.display = 'none';
    }
}

function renderNotifications() {
    if (!state.notifications || state.notifications.length === 0) {
        elements.notificationList.innerHTML = '<div class="notification-empty">No notifications</div>';
        return;
    }

    elements.notificationList.innerHTML = state.notifications.map(notification => {
        const timeAgo = formatTimeAgo(new Date(notification.created_at));
        const unreadClass = notification.read ? '' : 'unread';
        return `
            <div class="notification-item ${unreadClass}" data-id="${notification.id}">
                <div class="notification-item-title">
                    <span class="notification-type-icon ${notification.type}"></span>
                    ${escapeHtml(notification.title)}
                </div>
                <div class="notification-item-message">${escapeHtml(notification.message)}</div>
                <div class="notification-item-time">${timeAgo}</div>
            </div>
        `;
    }).join('');

    // Add click handlers to mark as read
    elements.notificationList.querySelectorAll('.notification-item').forEach(item => {
        item.addEventListener('click', () => {
            const id = item.dataset.id;
            markNotificationRead(id);
            item.classList.remove('unread');
        });
    });
}

async function markNotificationRead(id) {
    try {
        await fetch('/api/notifications/mark-read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ ids: [id] })
        });
        // Update local state
        const notification = state.notifications.find(n => n.id === id);
        if (notification && !notification.read) {
            notification.read = true;
            state.unreadCount = Math.max(0, state.unreadCount - 1);
            updateNotificationBadge();
        }
    } catch (error) {
        console.error('Failed to mark notification as read:', error);
    }
}

async function markAllNotificationsRead() {
    try {
        await fetch('/api/notifications/mark-read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ all: true })
        });
        // Update local state
        state.notifications.forEach(n => n.read = true);
        state.unreadCount = 0;
        updateNotificationBadge();
        renderNotifications();
    } catch (error) {
        console.error('Failed to mark all notifications as read:', error);
    }
}

function toggleNotificationPanel() {
    elements.notificationPanel.classList.toggle('open');
    if (elements.notificationPanel.classList.contains('open')) {
        elements.notificationBtn.style.display = 'none';
        fetchNotifications(); // Refresh when opening
    } else {
        elements.notificationBtn.style.display = 'flex';
    }
}

function closeNotificationPanel() {
    elements.notificationPanel.classList.remove('open');
    elements.notificationBtn.style.display = 'flex';
}

// ============ Function Call Detection ============

function detectFunctionCall(response) {
    // Try to parse as JSON to detect function call
    try {
        // Check if the response starts with { and ends with }
        const trimmed = response.trim();
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            const parsed = JSON.parse(trimmed);
            if (parsed.function === 'claude_execute' && parsed.prompt) {
                return parsed;
            }
        }
    } catch (e) {
        // Not JSON, return null
    }
    return null;
}

async function executeFunctionCall(functionCall) {
    showCurrentText('Executing Claude Code task...', true);
    setAvatarState('thinking');

    try {
        const res = await fetch('/api/claude/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                prompt: functionCall.prompt,
                project: functionCall.project || '/mnt/code'
            })
        });

        const data = await res.json();

        if (res.status === 401) {
            return "I need you to be authenticated to execute code tasks. Please log in first.";
        }

        if (res.status === 403) {
            if (data.task_created) {
                return "That task requires approval. I've created a task for review. Check your notifications for updates.";
            }
            return "That action was declined by the supervisor. " + (data.reason || '');
        }

        if (!res.ok) {
            return "Sorry, I couldn't start the task. " + (data.error || 'Unknown error');
        }

        if (data.status === 'pending_approval') {
            return "That task requires human approval before I can proceed. You'll get a notification when it's ready.";
        }

        if (data.status === 'queued') {
            return "I've started working on that task in the background. You'll get a notification when it's complete.";
        }

        return "Task has been queued. Check notifications for updates.";

    } catch (error) {
        console.error('Function call execution error:', error);
        return "Sorry, I encountered an error while trying to execute that task.";
    }
}

// ============ Helper Functions ============

function formatTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return date.toLocaleDateString();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
