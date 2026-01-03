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
    volume: 1.0,
    notifications: [],
    unreadCount: 0,
    notificationPollInterval: null,
    pendingAudio: null,  // Audio waiting for user gesture to play (mobile)
    // Terminal panel state
    terminalOpen: false,
    // Multi-session support
    sessions: {
        active: null,       // Currently viewed session ID
        list: {}            // Map of session objects
    }
    // Session object structure (stored in sessions.list):
    // {
    //     id: 'session-123',
    //     status: 'connecting' | 'running' | 'complete' | 'error' | 'approval',
    //     title: 'Task description...',
    //     output: [],             // Array of {type, content} lines
    //     eventSource: null,      // SSE connection
    //     claudeSessionId: null,  // For resume
    //     lineCount: 0,
    //     pendingApproval: false,
    //     approvalMessage: null,
    //     startTime: Date.now(),
    //     lastSummaryTime: 0
    // }
};

// DOM Elements
const elements = {};

// Waveform visualization variables (FormFlow style)
let waveformAnimationId = null;
let waveformAudioContext = null;
let waveformAnalyser = null;
let waveformAudioStream = null;

// Mobile audio unlock tracking
let mobileAudioUnlocked = false;

// Track audio elements that already have MediaElementSource attached
// (createMediaElementSource can only be called once per element)
const audioElementSources = new WeakMap();

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
    elements.volumeRange = document.getElementById('volumeRange');
    elements.volumeValue = document.getElementById('volumeValue');
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
    elements.loginDivider = document.getElementById('loginDivider');
    elements.passkeyLoginBtn = document.getElementById('passkeyLoginBtn');
    elements.passkeyList = document.getElementById('passkeyList');
    elements.registerPasskeyBtn = document.getElementById('registerPasskeyBtn');
    elements.logoutBtn = document.getElementById('logoutBtn');

    // Notification elements
    elements.notificationBtn = document.getElementById('notificationBtn');
    elements.notificationBadge = document.getElementById('notificationBadge');
    elements.notificationPanel = document.getElementById('notificationPanel');
    elements.notificationList = document.getElementById('notificationList');
    elements.closeNotifications = document.getElementById('closeNotifications');
    elements.markAllReadBtn = document.getElementById('markAllReadBtn');

    // Terminal elements
    elements.terminalOverlay = document.getElementById('terminalOverlay');
    elements.terminalWindow = document.getElementById('terminalWindow');
    elements.terminalContent = document.getElementById('terminalContent');
    elements.terminalApproval = document.getElementById('terminalApproval');
    elements.approvalMessage = document.getElementById('approvalMessage');
    elements.approveBtn = document.getElementById('approveBtn');
    elements.denyBtn = document.getElementById('denyBtn');
    elements.terminalStatus = document.getElementById('terminalStatus');
    elements.statusIndicator = document.getElementById('statusIndicator');
    elements.statusText = document.getElementById('statusText');
    elements.statusStats = document.getElementById('statusStats');
    elements.terminalClear = document.getElementById('terminalClear');
    elements.terminalCollapse = document.getElementById('terminalCollapse');
    elements.sessionTabs = document.getElementById('sessionTabs');
    elements.terminalToggleBtn = document.getElementById('terminalToggleBtn');
    elements.terminalExpandIcon = document.getElementById('terminalExpandIcon');
    elements.terminalCollapseIcon = document.getElementById('terminalCollapseIcon');
    elements.terminalBadge = document.getElementById('terminalBadge');
    elements.interviewOverlay = document.getElementById('interviewOverlay');

    // Set up event listeners
    elements.voiceAvatarContainer.addEventListener('click', toggleVoiceMode);
    elements.settingsBtn.addEventListener('click', openSettings);
    elements.closeSettings.addEventListener('click', closeSettings);
    elements.speedRange.addEventListener('input', updateSpeed);
    elements.volumeRange.addEventListener('input', updateVolume);
    elements.muteBtn.addEventListener('click', toggleMute);

    // Login event listeners
    elements.loginForm.addEventListener('submit', handleLogin);
    elements.passkeyLoginBtn.addEventListener('click', loginWithPasskey);
    elements.registerPasskeyBtn.addEventListener('click', registerPasskey);
    elements.logoutBtn.addEventListener('click', handleLogout);

    // Notification event listeners
    elements.notificationBtn.addEventListener('click', toggleNotificationPanel);
    elements.closeNotifications.addEventListener('click', closeNotificationPanel);
    elements.markAllReadBtn.addEventListener('click', markAllNotificationsRead);

    // Terminal event listeners
    elements.terminalToggleBtn.addEventListener('click', toggleTerminal);
    elements.terminalCollapse.addEventListener('click', collapseTerminal);
    elements.terminalClear.addEventListener('click', clearTerminalContent);
    elements.approveBtn.addEventListener('click', () => handleSessionApproval(true));
    elements.denyBtn.addEventListener('click', () => handleSessionApproval(false));
    elements.terminalContent.addEventListener('scroll', handleTerminalScroll);

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

    // Create audio context if needed
    if (!waveformAudioContext) {
        waveformAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    // Resume audio context if suspended (critical for mobile)
    if (waveformAudioContext.state === 'suspended') {
        waveformAudioContext.resume().catch(e => console.warn('Failed to resume audio context:', e));
    }

    // Create analyser
    waveformAnalyser = waveformAudioContext.createAnalyser();
    waveformAnalyser.fftSize = 256;
    waveformAnalyser.smoothingTimeConstant = 0.7;
    const bufferLength = waveformAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    // Check if this audio element already has a MediaElementSource
    // (createMediaElementSource can only be called ONCE per element)
    let source = audioElementSources.get(audioElement);
    if (!source) {
        try {
            source = waveformAudioContext.createMediaElementSource(audioElement);
            audioElementSources.set(audioElement, source);
        } catch (e) {
            // If it fails, the audio will still play but without visualization
            console.warn('Could not create MediaElementSource:', e);
            // Still run the animation with simulated amplitude
            startFallbackSpeakingAnimation(canvas, ctx, centerX, centerY, maxWaveHeight, speakingCurves);
            return;
        }
    }

    // Connect: source -> analyser -> destination
    try {
        source.disconnect(); // Disconnect from previous connections
    } catch (e) {
        // May not be connected, that's fine
    }
    source.connect(waveformAnalyser);
    waveformAnalyser.connect(waveformAudioContext.destination);

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

// Fallback animation when MediaElementSource fails (e.g., on mobile with CORS issues)
function startFallbackSpeakingAnimation(canvas, ctx, centerX, centerY, maxWaveHeight, speakingCurves) {
    let phase = 0;
    let smoothedAmplitude = 0.5; // Simulated amplitude

    function draw() {
        if (!state.isActive || !state.isSpeaking) return;
        waveformAnimationId = requestAnimationFrame(draw);

        // Simulate varying amplitude
        smoothedAmplitude = 0.4 + Math.sin(Date.now() / 300) * 0.2;

        if (window.neonOrb) {
            window.neonOrb.setAudioLevel(smoothedAmplitude);
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        let baseColor = { r: 255, g: 179, b: 71 }; // Orange for speaking
        const waveFrequency = 2.5;
        const amplitude = 5 + smoothedAmplitude * maxWaveHeight * 1.2;

        speakingCurves.forEach(curve => {
            ctx.beginPath();
            ctx.lineWidth = curve.lineWidth;
            ctx.strokeStyle = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${curve.opacity})`;
            ctx.lineCap = 'round';

            const waveWidth = canvas.width;
            for (let x = 0; x <= waveWidth; x++) {
                const normalizedX = x / waveWidth;
                const angle = normalizedX * Math.PI * 2 * waveFrequency + phase + (curve.attenuation * 0.15);
                const distanceFromCenter = Math.abs(x - centerX) / (waveWidth / 2);
                const amplitudeEnvelope = (1 - Math.pow(distanceFromCenter, 1.5)) * 1.8;
                const y = centerY + Math.sin(angle) * amplitude * (1 + curve.attenuation * 0.15) * amplitudeEnvelope;

                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
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
    // Don't close AudioContext - we want to reuse it for future audio
    // Closing it prevents mobile audio from working on subsequent plays
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
    // Unlock mobile audio on first interaction
    await unlockMobileAudio();

    // Play any pending audio that was blocked
    await playPendingAudio();

    // If AI is speaking, interrupt it (tap-to-interrupt feature)
    if (state.isSpeaking) {
        interruptBotResponse();
        return;
    }

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

        // Voice command interrupt detection - specific commands to stop AI
        const INTERRUPT_COMMANDS = ['stop', 'cancel', 'wait', 'pause', 'quiet', 'shut up', 'be quiet'];

        if (state.isSpeaking) {
            const transcript = (interim + final).toLowerCase();
            if (INTERRUPT_COMMANDS.some(cmd => transcript.includes(cmd))) {
                interruptBotResponse();
                // Clear transcripts to avoid processing the interrupt command
                state.finalTranscript = '';
                state.currentTranscript = '';
                return;
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

            // Check for voice approval commands if there's a pending approval
            if (hasAnyPendingApproval()) {
                const lowerFinal = final.toLowerCase().trim();
                if (checkVoiceApproval(lowerFinal)) {
                    // Voice approval handled - clear transcript and skip normal processing
                    state.finalTranscript = '';
                    return;
                }
            }

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
            // Determine execution mode: 'stream' shows terminal, 'quick' runs in background
            const isStreamMode = functionCall.mode === 'stream';

            // Get the spoken message (what the agent says before executing)
            const spokenMessage = functionCall.spokenMessage ||
                (isStreamMode
                    ? "Let me show you what I'm doing. Watch the terminal."
                    : "I'm working on that task for you. You'll get a notification when it's done.");

            // Update conversation with the spoken message
            state.conversationHistory.push(
                { role: 'user', content: userMessage },
                { role: 'assistant', content: spokenMessage }
            );

            // Speak the message first
            showCurrentText(spokenMessage, false);

            if (isStreamMode) {
                // Stream mode - open terminal and stream output
                await speakResponse(spokenMessage);
                executeFunctionCallWithStreaming(functionCall);
            } else {
                // Quick mode - execute in background (fire and forget)
                executeFunctionCallInBackground(functionCall);
                await speakResponse(spokenMessage);
            }
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
    return new Promise(async (resolve) => {
        try {
            // Ensure audio context is unlocked on mobile
            await unlockMobileAudio();

            // Resume audio context if suspended (critical for mobile)
            if (waveformAudioContext && waveformAudioContext.state === 'suspended') {
                await waveformAudioContext.resume();
            }

            // Convert base64 to blob for better mobile compatibility
            const byteCharacters = atob(base64Data);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);

            // Detect audio format from header bytes
            let mimeType = 'audio/mpeg'; // Default to MP3
            if (byteArray.length > 4) {
                // Check for WAV header (RIFF)
                if (byteArray[0] === 0x52 && byteArray[1] === 0x49 && byteArray[2] === 0x46 && byteArray[3] === 0x46) {
                    mimeType = 'audio/wav';
                }
                // Check for OGG header (OggS)
                else if (byteArray[0] === 0x4F && byteArray[1] === 0x67 && byteArray[2] === 0x67 && byteArray[3] === 0x53) {
                    mimeType = 'audio/ogg';
                }
                // Check for FLAC header (fLaC)
                else if (byteArray[0] === 0x66 && byteArray[1] === 0x4C && byteArray[2] === 0x61 && byteArray[3] === 0x43) {
                    mimeType = 'audio/flac';
                }
            }

            const blob = new Blob([byteArray], { type: mimeType });
            const audioUrl = URL.createObjectURL(blob);

            const audio = new Audio();
            state.aiAudio = audio;

            // Set attributes before setting src (important for mobile)
            audio.preload = 'auto';
            audio.volume = state.volume;

            // iOS Safari needs these attributes
            audio.setAttribute('playsinline', 'true');
            audio.setAttribute('webkit-playsinline', 'true');

            audio.onplay = () => {
                startSpeakingWaveform(audio);
            };

            audio.onended = () => {
                state.aiAudio = null;
                state.isSpeaking = false;
                URL.revokeObjectURL(audioUrl);
                resolve();
            };

            audio.onerror = (e) => {
                console.error('Audio playback error:', e, audio.error);
                state.aiAudio = null;
                state.isSpeaking = false;
                URL.revokeObjectURL(audioUrl);
                resolve();
            };

            // Set source after event handlers
            audio.src = audioUrl;

            // Use canplaythrough event for more reliable mobile playback
            audio.oncanplaythrough = async () => {
                try {
                    await audio.play();
                } catch (error) {
                    console.error('Audio play failed:', error);
                    // On mobile, if autoplay fails, try playing on next user interaction
                    if (error.name === 'NotAllowedError') {
                        console.warn('Autoplay blocked - audio requires user interaction');
                        // Store for later playback on user gesture
                        state.pendingAudio = audio;
                    }
                    state.isSpeaking = false;
                    URL.revokeObjectURL(audioUrl);
                    resolve();
                }
            };

            // Start loading
            audio.load();

        } catch (error) {
            console.error('Audio playback error:', error);
            state.isSpeaking = false;
            resolve();
        }
    });
}

// Unlock audio on mobile devices (must be called from user gesture)
async function unlockMobileAudio() {
    if (mobileAudioUnlocked) return;

    try {
        // Create or get the shared audio context
        if (!waveformAudioContext) {
            waveformAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        // Resume if suspended (common on mobile)
        if (waveformAudioContext.state === 'suspended') {
            await waveformAudioContext.resume();
        }

        // Play silent audio to unlock HTMLAudioElement playback on iOS
        const silentBuffer = waveformAudioContext.createBuffer(1, 1, 22050);
        const source = waveformAudioContext.createBufferSource();
        source.buffer = silentBuffer;
        source.connect(waveformAudioContext.destination);
        source.start(0);

        // Also create and play a silent HTML audio element to unlock that path
        try {
            const silentAudio = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=');
            silentAudio.volume = 0.01;
            await silentAudio.play();
            silentAudio.pause();
        } catch (e) {
            // Silent audio play may fail, that's okay
        }

        mobileAudioUnlocked = true;
        console.log('Mobile audio unlocked');
    } catch (e) {
        console.warn('Failed to unlock mobile audio:', e);
    }
}

// Play any pending audio that was blocked on mobile
async function playPendingAudio() {
    if (state.pendingAudio) {
        const audio = state.pendingAudio;
        state.pendingAudio = null;
        try {
            await audio.play();
            state.isSpeaking = true;
            startSpeakingWaveform(audio);
        } catch (e) {
            console.warn('Still cannot play pending audio:', e);
        }
    }
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

// Trigger haptic feedback on mobile devices
function triggerHapticFeedback() {
    if ('vibrate' in navigator) {
        navigator.vibrate(50);
    }
}

// Interrupt the bot's response with visual/haptic feedback
function interruptBotResponse() {
    // Trigger haptic feedback
    triggerHapticFeedback();

    // Show red interrupt glow briefly
    elements.voiceAvatarContainer.classList.add('interrupting');
    setTimeout(() => {
        elements.voiceAvatarContainer.classList.remove('interrupting');
    }, 500);

    // Fade out the audio and transition to listening
    fadeOutAudio();
}

function browserSpeak(text) {
    return new Promise((resolve) => {
        if (!('speechSynthesis' in window)) {
            resolve();
            return;
        }

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = state.speechSpeed;
        utterance.volume = state.volume;
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
        speechSpeed: state.speechSpeed,
        volume: state.volume
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
            if (settings.volume !== undefined) state.volume = settings.volume;

            // Update UI for speed
            if (elements.speedRange && elements.speedValue) {
                elements.speedRange.value = state.speechSpeed;
                elements.speedValue.textContent = `${state.speechSpeed}x`;
            }

            // Update UI for volume
            if (elements.volumeRange && elements.volumeValue) {
                elements.volumeRange.value = state.volume;
                elements.volumeValue.textContent = `${Math.round(state.volume * 100)}%`;
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

function updateVolume(e) {
    state.volume = parseFloat(e.target.value);
    elements.volumeValue.textContent = `${Math.round(state.volume * 100)}%`;
    saveSettingsToStorage();

    // Update currently playing audio if any
    if (state.aiAudio) {
        state.aiAudio.volume = state.volume;
    }
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
            loadPasskeys(); // Load passkeys in settings when authenticated
        } else {
            state.isAuthenticated = false;
            elements.loginOverlay.classList.remove('hidden');

            // Check if passkeys are available and WebAuthn is supported
            if (data.has_passkeys && window.PublicKeyCredential) {
                elements.loginDivider.style.display = 'flex';
                elements.passkeyLoginBtn.style.display = 'flex';
            } else {
                elements.loginDivider.style.display = 'none';
                elements.passkeyLoginBtn.style.display = 'none';
            }
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

// ============ Passkey (WebAuthn) Functions ============

async function loginWithPasskey() {
    if (!window.PublicKeyCredential) {
        elements.loginError.textContent = 'WebAuthn not supported in this browser';
        return;
    }

    try {
        elements.loginError.textContent = '';
        elements.passkeyLoginBtn.disabled = true;
        elements.passkeyLoginBtn.textContent = 'Authenticating...';

        // Get authentication options from server
        const optionsRes = await fetch('/api/auth/passkey/auth-options', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
        });

        if (!optionsRes.ok) {
            throw new Error('Failed to get authentication options');
        }

        const options = await optionsRes.json();

        // Convert base64url to ArrayBuffer
        options.challenge = base64UrlToArrayBuffer(options.challenge);
        if (options.allowCredentials) {
            options.allowCredentials = options.allowCredentials.map(cred => ({
                ...cred,
                id: base64UrlToArrayBuffer(cred.id)
            }));
        }

        // Request credential from authenticator
        const credential = await navigator.credentials.get({
            publicKey: options
        });

        // Send credential to server for verification
        const verifyRes = await fetch('/api/auth/passkey/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                id: credential.id,
                rawId: arrayBufferToBase64Url(credential.rawId),
                response: {
                    authenticatorData: arrayBufferToBase64Url(credential.response.authenticatorData),
                    clientDataJSON: arrayBufferToBase64Url(credential.response.clientDataJSON),
                    signature: arrayBufferToBase64Url(credential.response.signature),
                    userHandle: credential.response.userHandle ?
                        arrayBufferToBase64Url(credential.response.userHandle) : null
                },
                type: credential.type
            })
        });

        const data = await verifyRes.json();

        if (verifyRes.ok && data.success) {
            state.isAuthenticated = true;
            elements.loginOverlay.classList.add('hidden');
            elements.loginError.textContent = '';
            startNotificationPolling();
            loadPasskeys();
        } else {
            elements.loginError.textContent = data.error || 'Passkey authentication failed';
        }

    } catch (error) {
        console.error('Passkey login error:', error);
        if (error.name === 'NotAllowedError') {
            elements.loginError.textContent = 'Authentication cancelled';
        } else {
            elements.loginError.textContent = 'Passkey authentication failed';
        }
    } finally {
        elements.passkeyLoginBtn.disabled = false;
        elements.passkeyLoginBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                <path d="M12 1C8.14 1 5 4.14 5 8c0 2.38 1.19 4.47 3 5.74V17h2v-2h4v2h2v-3.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7zm-1 11H9V9h2v3zm4 0h-2V9h2v3z"/>
            </svg>
            Login with Passkey`;
    }
}

async function registerPasskey() {
    if (!window.PublicKeyCredential) {
        alert('WebAuthn not supported in this browser');
        return;
    }

    if (!state.isAuthenticated) {
        alert('Please log in first to register a passkey');
        return;
    }

    try {
        elements.registerPasskeyBtn.disabled = true;
        elements.registerPasskeyBtn.textContent = 'Registering...';

        // Get registration options from server
        const optionsRes = await fetch('/api/auth/passkey/register-options', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
        });

        if (!optionsRes.ok) {
            throw new Error('Failed to get registration options');
        }

        const options = await optionsRes.json();

        // Convert base64url to ArrayBuffer
        options.challenge = base64UrlToArrayBuffer(options.challenge);
        options.user.id = base64UrlToArrayBuffer(options.user.id);
        if (options.excludeCredentials) {
            options.excludeCredentials = options.excludeCredentials.map(cred => ({
                ...cred,
                id: base64UrlToArrayBuffer(cred.id)
            }));
        }

        // Create credential with authenticator
        const credential = await navigator.credentials.create({
            publicKey: options
        });

        // Send credential to server for registration
        const registerRes = await fetch('/api/auth/passkey/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                id: credential.id,
                rawId: arrayBufferToBase64Url(credential.rawId),
                response: {
                    attestationObject: arrayBufferToBase64Url(credential.response.attestationObject),
                    clientDataJSON: arrayBufferToBase64Url(credential.response.clientDataJSON)
                },
                type: credential.type
            })
        });

        const data = await registerRes.json();

        if (registerRes.ok && data.success) {
            alert('Passkey registered successfully!');
            loadPasskeys();
        } else {
            alert(data.error || 'Failed to register passkey');
        }

    } catch (error) {
        console.error('Passkey registration error:', error);
        if (error.name === 'NotAllowedError') {
            alert('Registration cancelled');
        } else if (error.name === 'InvalidStateError') {
            alert('This passkey is already registered');
        } else {
            alert('Failed to register passkey: ' + error.message);
        }
    } finally {
        elements.registerPasskeyBtn.disabled = false;
        elements.registerPasskeyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
            </svg>
            Add New Passkey`;
    }
}

async function loadPasskeys() {
    try {
        const res = await fetch('/api/auth/passkey/list', { credentials: 'include' });
        const data = await res.json();

        if (!data.passkeys || data.passkeys.length === 0) {
            elements.passkeyList.innerHTML = '<div class="notification-empty" style="padding: 0.5rem; font-size: 0.8rem;">No passkeys registered</div>';
            return;
        }

        elements.passkeyList.innerHTML = data.passkeys.map(passkey => {
            const createdDate = new Date(passkey.created_at).toLocaleDateString();
            return `
                <div class="passkey-item" data-id="${passkey.id}">
                    <div class="passkey-item-info">
                        <span class="passkey-item-name">${escapeHtml(passkey.name || 'Passkey')}</span>
                        <span class="passkey-item-date">Added ${createdDate}</span>
                    </div>
                    <button class="passkey-delete-btn" onclick="deletePasskey('${passkey.id}')" title="Delete passkey">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                        </svg>
                    </button>
                </div>
            `;
        }).join('');

    } catch (error) {
        console.error('Failed to load passkeys:', error);
    }
}

async function deletePasskey(id) {
    if (!confirm('Are you sure you want to delete this passkey?')) {
        return;
    }

    try {
        const res = await fetch('/api/auth/passkey/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ id })
        });

        const data = await res.json();

        if (res.ok && data.success) {
            loadPasskeys();
        } else {
            alert(data.error || 'Failed to delete passkey');
        }
    } catch (error) {
        console.error('Failed to delete passkey:', error);
        alert('Failed to delete passkey');
    }
}

async function handleLogout() {
    try {
        const res = await fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'include'
        });

        if (res.ok) {
            state.isAuthenticated = false;
            stopNotificationPolling();
            stopVoiceMode();
            closeSettings();
            elements.loginOverlay.classList.remove('hidden');

            // Re-check auth status to update passkey button visibility
            checkAuthStatus();
        }
    } catch (error) {
        console.error('Logout error:', error);
    }
}

// WebAuthn helper functions
function base64UrlToArrayBuffer(base64url) {
    const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - base64.length % 4) % 4);
    const binary = atob(base64 + padding);
    const buffer = new ArrayBuffer(binary.length);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i++) {
        view[i] = binary.charCodeAt(i);
    }
    return buffer;
}

function arrayBufferToBase64Url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
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

        const newNotifications = data.notifications || [];
        const previousIds = new Set(state.notifications.map(n => n.id));

        // Find truly new notifications (ones we haven't seen before)
        const brandNewNotifications = newNotifications.filter(n =>
            !previousIds.has(n.id) && !n.read
        );

        state.notifications = newNotifications;
        state.unreadCount = data.unread_count || 0;
        updateNotificationBadge();
        renderNotifications();

        // If we have new notifications and voice mode is active, announce them
        if (brandNewNotifications.length > 0 && state.isActive && !state.isSpeaking && !state.isProcessing) {
            for (const notification of brandNewNotifications) {
                // Only announce completion/error notifications (not "started" ones)
                if (notification.type === 'success' || notification.type === 'error') {
                    await announceNotification(notification);
                }
            }
        }
    } catch (error) {
        console.error('Failed to fetch notifications:', error);
    }
}

// Announce a notification to the user during active conversation
async function announceNotification(notification) {
    // Don't interrupt if already speaking or processing
    if (state.isSpeaking || state.isProcessing) return;

    // Stop listening temporarily
    const wasListening = state.isListening;
    if (state.recognition) {
        try { state.recognition.stop(); } catch (e) {}
    }
    state.isListening = false;

    // Create announcement message
    let announcement = '';
    if (notification.type === 'success') {
        announcement = `Task completed: ${notification.title}. ${notification.message.split('\n')[0]}`;
    } else if (notification.type === 'error') {
        announcement = `Task failed: ${notification.message.split('\n')[0]}`;
    } else {
        announcement = notification.message.split('\n')[0];
    }

    // Truncate long messages
    if (announcement.length > 150) {
        announcement = announcement.substring(0, 147) + '...';
    }

    // Add to conversation history
    state.conversationHistory.push({
        role: 'assistant',
        content: `[Notification] ${announcement}`
    });

    // Show and speak the announcement
    showCurrentText(announcement, false);
    await speakResponse(announcement);

    // Resume listening if we were before (handled by speakResponse callback)
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

    // Add click handlers to mark as read and possibly show terminal
    elements.notificationList.querySelectorAll('.notification-item').forEach(item => {
        item.addEventListener('click', () => {
            const id = item.dataset.id;
            markNotificationRead(id);
            item.classList.remove('unread');

            // Check if this notification has a job_id with stored output
            const notification = state.notifications.find(n => n.id === id);
            if (notification && notification.job_id) {
                showTerminalForJob(notification.job_id, notification.title);
            }
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
    const trimmed = response.trim();

    // First, check if there's a spoken message followed by JSON on a new line
    // This is the new format: "I'm asking Claude to..." followed by {"function": ...}
    const jsonLinePattern = /^([\s\S]*?)\n\s*(\{"function"\s*:\s*"claude_execute"[\s\S]*?\})\s*$/;
    const jsonLineMatch = trimmed.match(jsonLinePattern);
    if (jsonLineMatch && jsonLineMatch[1] && jsonLineMatch[2]) {
        try {
            const parsed = JSON.parse(jsonLineMatch[2]);
            if (parsed.function === 'claude_execute' && parsed.prompt) {
                console.log('Function call with message detected:', parsed);
                return {
                    ...parsed,
                    spokenMessage: jsonLineMatch[1].trim()
                };
            }
        } catch (e) {
            // Continue to other patterns
        }
    }

    // Try multiple extraction methods
    const jsonPatterns = [
        // Direct JSON object
        /^\s*(\{[\s\S]*\})\s*$/,
        // Markdown code block with json
        /```json\s*(\{[\s\S]*?\})\s*```/,
        // Markdown code block without language
        /```\s*(\{[\s\S]*?\})\s*```/,
        // JSON embedded in text (look for function pattern)
        /(\{"function"\s*:\s*"claude_execute"[\s\S]*?\})/
    ];

    for (const pattern of jsonPatterns) {
        const match = trimmed.match(pattern);
        if (match && match[1]) {
            try {
                const parsed = JSON.parse(match[1]);
                if (parsed.function === 'claude_execute' && parsed.prompt) {
                    console.log('Function call detected:', parsed);
                    // Extract any text before the JSON as the spoken message
                    const beforeJson = trimmed.substring(0, trimmed.indexOf(match[1])).trim();
                    if (beforeJson) {
                        parsed.spokenMessage = beforeJson;
                    }
                    return parsed;
                }
            } catch (e) {
                // Continue to next pattern
            }
        }
    }

    // Fallback: try to parse the whole response
    try {
        const parsed = JSON.parse(trimmed);
        if (parsed.function === 'claude_execute' && parsed.prompt) {
            return parsed;
        }
    } catch (e) {
        // Not JSON
    }

    return null;
}

// Execute function call in background (fire and forget)
function executeFunctionCallInBackground(functionCall) {
    // Execute async without blocking the conversation
    fetch('/api/claude/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
            prompt: functionCall.prompt,
            project: functionCall.project || '/mnt/code'
        })
    }).then(res => {
        if (!res.ok) {
            console.error('Function call failed:', res.status);
            // A notification will be created by the server for errors too
        }
    }).catch(error => {
        console.error('Function call execution error:', error);
    });
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

// ============ Terminal Streaming Functions ============

/**
 * Open terminal window and start streaming Claude Code execution
 */
// ============ Terminal Toggle Functions ============

/**
 * Toggle terminal panel open/closed
 */
function toggleTerminal() {
    if (state.terminalOpen) {
        collapseTerminal();
    } else {
        expandTerminal();
    }
}

/**
 * Expand/show terminal panel
 */
function expandTerminal() {
    state.terminalOpen = true;
    elements.terminalOverlay.classList.add('open');
    elements.interviewOverlay.classList.add('terminal-active');
    elements.terminalExpandIcon.style.display = 'none';
    elements.terminalCollapseIcon.style.display = 'block';
    renderSessionOutput();
}

/**
 * Collapse/hide terminal panel
 */
function collapseTerminal() {
    state.terminalOpen = false;
    elements.terminalOverlay.classList.remove('open');
    elements.interviewOverlay.classList.remove('terminal-active');
    elements.terminalExpandIcon.style.display = 'block';
    elements.terminalCollapseIcon.style.display = 'none';
    updateTerminalBadge();
}

/**
 * Update the terminal badge showing active session count
 */
function updateTerminalBadge() {
    const activeSessions = Object.values(state.sessions.list).filter(s =>
        s.status === 'running' || s.status === 'connecting' || s.status === 'approval'
    ).length;

    if (activeSessions > 0 && !state.terminalOpen) {
        elements.terminalBadge.textContent = activeSessions;
        elements.terminalBadge.style.display = 'flex';
    } else {
        elements.terminalBadge.style.display = 'none';
    }
}

// ============ Session Management Functions ============

/**
 * Generate unique session ID
 */
function generateSessionId() {
    return 'session-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

/**
 * Create a new Claude session and start streaming
 */
function createSession(prompt, project) {
    const sessionId = generateSessionId();

    // Create session object
    state.sessions.list[sessionId] = {
        id: sessionId,
        status: 'connecting',
        title: prompt.substring(0, 40) + (prompt.length > 40 ? '...' : ''),
        output: [],
        eventSource: null,
        claudeSessionId: null,
        lineCount: 0,
        pendingApproval: false,
        approvalMessage: null,
        startTime: Date.now(),
        lastSummaryTime: Date.now()
    };

    // Switch to new session and expand terminal
    state.sessions.active = sessionId;
    expandTerminal();
    renderSessionTabs();

    // Start SSE stream
    startSessionStream(sessionId, prompt, project);

    return sessionId;
}

/**
 * Start SSE stream for a session
 */
function startSessionStream(sessionId, prompt, project) {
    const session = state.sessions.list[sessionId];
    if (!session) return;

    const url = `/api/claude/stream?prompt=${encodeURIComponent(prompt)}&project=${encodeURIComponent(project || '/mnt/code')}`;

    session.eventSource = new EventSource(url);

    session.eventSource.onopen = () => {
        session.status = 'running';
        renderSessionTabs();
        if (state.sessions.active === sessionId) {
            updateTerminalStatus('running', 'Running');
        }
    };

    session.eventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleSessionEvent(sessionId, data);
        } catch (e) {
            console.error('Failed to parse session event:', e);
        }
    };

    session.eventSource.onerror = (error) => {
        console.error('Session stream error:', error);
        session.status = 'error';
        renderSessionTabs();

        if (session.eventSource) {
            session.eventSource.close();
            session.eventSource = null;
        }

        if (state.sessions.active === sessionId) {
            updateTerminalStatus('error', 'Connection error');
        }
    };
}

/**
 * Switch to a different session
 */
function switchSession(sessionId) {
    if (!state.sessions.list[sessionId]) return;

    state.sessions.active = sessionId;
    renderSessionTabs();
    renderSessionOutput();

    // Update status bar for active session
    const session = state.sessions.list[sessionId];
    if (session.status === 'running' || session.status === 'connecting') {
        updateTerminalStatus('running', session.status === 'connecting' ? 'Connecting...' : 'Running');
    } else if (session.status === 'complete') {
        updateTerminalStatus('complete', 'Complete');
    } else if (session.status === 'error') {
        updateTerminalStatus('error', 'Error');
    } else if (session.status === 'approval') {
        updateTerminalStatus('approval', 'Approval needed');
    }

    // Show approval panel if needed
    if (session.pendingApproval) {
        elements.approvalMessage.textContent = session.approvalMessage || 'Claude needs permission to continue.';
        elements.terminalApproval.classList.add('visible');
    } else {
        elements.terminalApproval.classList.remove('visible');
    }
}

/**
 * Close/remove a session
 */
function closeSession(sessionId) {
    const session = state.sessions.list[sessionId];
    if (!session) return;

    // Close SSE connection if active
    if (session.eventSource) {
        session.eventSource.close();
    }

    // Remove from list
    delete state.sessions.list[sessionId];

    // If this was the active session, switch to another
    if (state.sessions.active === sessionId) {
        const remaining = Object.keys(state.sessions.list);
        state.sessions.active = remaining.length > 0 ? remaining[remaining.length - 1] : null;
    }

    renderSessionTabs();
    renderSessionOutput();
    updateTerminalBadge();
}

// Make closeSession available globally for onclick handlers
window.closeSession = closeSession;

/**
 * Render session tabs
 */
function renderSessionTabs() {
    const container = elements.sessionTabs;
    if (!container) return;

    container.innerHTML = '';

    const sessions = Object.values(state.sessions.list);

    if (sessions.length === 0) {
        // Show placeholder
        const placeholder = document.createElement('div');
        placeholder.className = 'session-tabs-empty';
        placeholder.textContent = 'No sessions';
        placeholder.style.cssText = 'color: var(--text-muted); font-size: 0.75rem; padding: 6px 12px;';
        container.appendChild(placeholder);
        return;
    }

    sessions.forEach(session => {
        const tab = document.createElement('button');
        tab.className = 'session-tab' + (session.id === state.sessions.active ? ' active' : '');
        tab.innerHTML = `
            <span class="status-dot ${session.status}"></span>
            <span class="session-title">${escapeHtml(session.title)}</span>
            <button class="close-tab" onclick="event.stopPropagation(); closeSession('${session.id}')">&times;</button>
        `;
        tab.onclick = () => switchSession(session.id);
        container.appendChild(tab);
    });

    updateTerminalBadge();
}

/**
 * Render session output in terminal content area
 */
function renderSessionOutput() {
    const container = elements.terminalContent;
    if (!container) return;

    const session = state.sessions.list[state.sessions.active];

    if (!session) {
        container.innerHTML = '<div class="terminal-empty">No active sessions. Ask me to do something!</div>';
        elements.statusText.textContent = 'Ready';
        elements.statusStats.textContent = '';
        elements.terminalApproval.classList.remove('visible');
        return;
    }

    // Render output lines
    container.innerHTML = '';
    session.output.forEach(line => {
        const div = document.createElement('div');
        div.className = `terminal-line ${line.type}`;
        div.textContent = line.content;
        container.appendChild(div);
    });

    // Scroll to bottom
    container.scrollTop = container.scrollHeight;

    // Update status
    elements.statusStats.textContent = `${session.lineCount} lines`;
}

// Legacy function name for compatibility
function openTerminalWithStream(prompt, project) {
    createSession(prompt, project);
}

/**
 * Handle incoming session stream events
 */
function handleSessionEvent(sessionId, event) {
    const session = state.sessions.list[sessionId];
    if (!session) return;

    switch (event.type) {
        case 'session_start':
            session.claudeSessionId = event.session_id;
            appendSessionLine(sessionId, 'system', `Session started: ${event.session_id}`);
            break;

        case 'output':
            appendSessionLine(sessionId, event.line_type || 'assistant', event.content);
            break;

        case 'raw':
            // Raw output line from Claude
            appendSessionLine(sessionId, 'assistant', event.line);
            break;

        case 'summary':
            handleSessionProgressSummary(sessionId, event);
            break;

        case 'approval_needed':
            handleSessionApprovalNeeded(sessionId, event);
            break;

        case 'complete':
            handleSessionComplete(sessionId, event);
            break;

        case 'error':
            appendSessionLine(sessionId, 'error', event.message || 'An error occurred');
            session.status = 'error';
            renderSessionTabs();
            if (state.sessions.active === sessionId) {
                updateTerminalStatus('error', 'Error');
            }
            break;

        default:
            console.log('Unknown session event:', event);
    }
}

/**
 * Append a line to a session's output buffer
 */
function appendSessionLine(sessionId, type, content) {
    if (!content) return;

    const session = state.sessions.list[sessionId];
    if (!session) return;

    // Add to session output buffer
    session.output.push({ type, content });
    session.lineCount++;

    // Limit buffer size (keep last 500 lines)
    if (session.output.length > 500) {
        session.output.shift();
    }

    // If this is the active session, update the display
    if (state.sessions.active === sessionId) {
        const line = document.createElement('div');
        line.className = `terminal-line ${type}`;
        line.textContent = content;
        elements.terminalContent.appendChild(line);

        // Auto-scroll if user is not scrolling
        if (!session.isUserScrolling) {
            elements.terminalContent.scrollTop = elements.terminalContent.scrollHeight;
        }

        // Update stats
        elements.statusStats.textContent = `${session.lineCount} lines`;
    }
}

/**
 * Handle progress summary from session stream
 */
function handleSessionProgressSummary(sessionId, event) {
    const session = state.sessions.list[sessionId];
    if (!session) return;

    const summary = event.summary;
    if (!summary) return;

    // Display conversational summary in terminal
    const summaryText = summary.conversational || `[Progress] ${summary.event_count} events processed`;
    appendSessionLine(sessionId, 'summary', summaryText);

    // Add to conversation history for AI awareness (simplified)
    state.conversationHistory.push({
        role: 'system',
        content: `[Claude Code Progress] ${summary.conversational}`
    });

    // Speak conversational progress if it's been a while and we're active
    const timeSinceLastSummary = Date.now() - (session.lastSummaryTime || session.startTime);
    if (timeSinceLastSummary > 45000 && !state.isSpeaking && state.isActive && summary.conversational) {
        // Speak the conversational update
        speakResponse(summary.conversational).catch(() => {});
    }

    session.lastSummaryTime = Date.now();
}

/**
 * Handle approval request for a session
 */
function handleSessionApprovalNeeded(sessionId, event) {
    const session = state.sessions.list[sessionId];
    if (!session) return;

    session.pendingApproval = true;
    session.approvalMessage = event.message || 'Claude needs permission to continue.';
    session.status = 'approval';

    // Append to session
    appendSessionLine(sessionId, 'system', `⚠️ APPROVAL NEEDED: ${session.approvalMessage}`);

    // Update tabs to show approval status
    renderSessionTabs();

    // If this is the active session, show approval panel
    if (state.sessions.active === sessionId) {
        elements.approvalMessage.textContent = session.approvalMessage;
        elements.terminalApproval.classList.add('visible');
        updateTerminalStatus('approval', 'Approval needed');
    }

    // Announce via voice if active
    if (state.isActive && !state.isSpeaking) {
        speakResponse(`Approval needed: ${session.approvalMessage}`).catch(() => {});
    }
}

/**
 * Handle user approval/denial via buttons for active session
 */
async function handleSessionApproval(approved) {
    const sessionId = state.sessions.active;
    if (!sessionId) return;

    const session = state.sessions.list[sessionId];
    if (!session || !session.pendingApproval) return;

    session.pendingApproval = false;
    elements.terminalApproval.classList.remove('visible');

    const action = approved ? 'approved' : 'denied';
    appendSessionLine(sessionId, 'system', `User ${action} the request`);

    try {
        const res = await fetch('/api/claude/stream/approve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                session_id: session.claudeSessionId || sessionId,
                approved: approved
            })
        });

        const data = await res.json();

        if (res.ok) {
            session.status = 'running';
            updateTerminalStatus('running', approved ? 'Continuing...' : 'Stopping...');
            renderSessionTabs();

            // Speak confirmation
            if (state.isActive) {
                const msg = approved ? 'Approved. Continuing.' : 'Denied. Stopping task.';
                speakResponse(msg).catch(() => {});
            }
        } else {
            appendSessionLine(sessionId, 'error', data.error || 'Failed to send approval');
        }
    } catch (error) {
        console.error('Approval error:', error);
        appendSessionLine(sessionId, 'error', 'Failed to communicate approval');
    }
}

/**
 * Handle session completion
 */
function handleSessionComplete(sessionId, event) {
    const session = state.sessions.list[sessionId];
    if (!session) return;

    // Close the SSE connection
    if (session.eventSource) {
        session.eventSource.close();
        session.eventSource = null;
    }

    // Store Claude session ID for potential resume
    if (event.claude_session_id) {
        session.claudeSessionId = event.claude_session_id;
    }

    // Update session status
    session.status = event.success ? 'complete' : 'error';
    renderSessionTabs();

    // Final summary line
    appendSessionLine(sessionId, 'system', `\n--- Task ${event.success ? 'completed' : 'failed'} ---`);

    // Show conversational summary if available
    const summary = event.summary;
    if (summary && summary.text) {
        appendSessionLine(sessionId, 'success', summary.text);

        // Show files modified if any
        if (summary.files_modified && summary.files_modified.length > 0) {
            appendSessionLine(sessionId, 'system', `Files: ${summary.files_modified.join(', ')}`);
        }
    }

    // Update status bar if this is the active session
    if (state.sessions.active === sessionId) {
        const statusText = event.success ? 'Complete' : 'Failed';
        updateTerminalStatus(session.status, statusText);
    }

    // Update terminal badge
    updateTerminalBadge();

    // Announce completion with conversational summary
    if (state.isActive && !state.isSpeaking) {
        let msg;
        if (event.success && summary && summary.text) {
            // Use the conversational summary (it's already human-friendly)
            msg = summary.text;
        } else if (event.success) {
            msg = 'Task completed successfully.';
        } else {
            msg = 'Task finished with some errors. Check the output for details.';
        }
        speakResponse(msg).catch(() => {});
    }

    // Add to conversation history
    if (summary && summary.text) {
        state.conversationHistory.push({
            role: 'assistant',
            content: `[Task Complete] ${summary.text}`
        });
    }
}

/**
 * Update terminal status bar
 */
function updateTerminalStatus(status, text) {
    elements.statusIndicator.className = `status-indicator ${status}`;
    elements.statusText.textContent = text;
}

/**
 * Handle terminal scroll to detect user scrolling
 */
function handleTerminalScroll() {
    const sessionId = state.sessions.active;
    if (!sessionId) return;

    const session = state.sessions.list[sessionId];
    if (!session) return;

    const content = elements.terminalContent;
    const isNearBottom = content.scrollHeight - content.scrollTop - content.clientHeight < 50;

    if (!isNearBottom) {
        session.isUserScrolling = true;
        clearTimeout(session.scrollTimeout);
        session.scrollTimeout = setTimeout(() => {
            session.isUserScrolling = false;
        }, 3000);
    } else {
        session.isUserScrolling = false;
    }
}

/**
 * Clear terminal content for current session
 */
function clearTerminalContent() {
    const sessionId = state.sessions.active;
    if (sessionId) {
        const session = state.sessions.list[sessionId];
        if (session) {
            session.output = [];
            session.lineCount = 0;
        }
    }
    elements.terminalContent.innerHTML = '';
    elements.statusStats.textContent = '0 lines';
}

/**
 * Execute function call with streaming (opens terminal)
 */
function executeFunctionCallWithStreaming(functionCall) {
    openTerminalWithStream(functionCall.prompt, functionCall.project);
}

/**
 * Check for voice approval commands
 * Returns true if an approval command was detected and handled
 */
function checkVoiceApproval(text) {
    // Approval keywords
    const approveKeywords = ['approve', 'approved', 'yes', 'allow', 'continue', 'go ahead', 'do it', 'proceed'];
    const denyKeywords = ['deny', 'denied', 'no', 'reject', 'stop', 'cancel', 'don\'t', 'abort'];

    // Check for approval
    for (const keyword of approveKeywords) {
        if (text.includes(keyword)) {
            handleSessionApproval(true);
            return true;
        }
    }

    // Check for denial
    for (const keyword of denyKeywords) {
        if (text.includes(keyword)) {
            handleSessionApproval(false);
            return true;
        }
    }

    return false;
}

/**
 * Check if any session has pending approval
 */
function hasAnyPendingApproval() {
    return Object.values(state.sessions.list).some(s => s.pendingApproval);
}

/**
 * Show terminal with stored output for a job
 * Called when clicking on a code execution notification
 */
function showTerminalForJob(jobId, title) {
    // Check if session already exists
    let session = state.sessions.list[jobId];

    if (!session) {
        // Create a replay session from job ID
        session = {
            id: jobId,
            status: 'complete',
            title: title || `Job ${jobId.slice(0, 8)}`,
            output: [],
            eventSource: null,
            claudeSessionId: jobId,
            lineCount: 0,
            pendingApproval: false,
            approvalMessage: null,
            startTime: Date.now(),
            lastSummaryTime: Date.now()
        };

        // Add a message about history not being available
        session.output.push({ type: 'system', content: 'Job output is not available for replay.' });
        session.output.push({ type: 'system', content: 'Output is only preserved during the session that created it.' });
        session.lineCount = 2;

        state.sessions.list[jobId] = session;
    }

    // Switch to this session and show terminal
    state.sessions.active = jobId;
    expandTerminal();
    renderSessionTabs();
    renderSessionOutput();

    // Close notification panel
    closeNotificationPanel();
}

// Make deletePasskey available globally for onclick handlers
window.deletePasskey = deletePasskey;
