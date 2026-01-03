/**
 * WebGL Neon Orb - A stunning generative art piece
 * Uses Three.js with custom shaders and particle systems
 */

class NeonOrb {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) return;

        this.width = this.container.offsetWidth || 200;
        this.height = this.container.offsetHeight || 200;
        this.state = 'idle'; // idle, listening, speaking, thinking
        this.audioLevel = 0;

        this.init();
        this.createOrb();
        this.createParticles();
        this.createAura();
        this.animate();

        // Handle resize
        window.addEventListener('resize', () => this.onResize());
    }

    init() {
        // Scene
        this.scene = new THREE.Scene();

        // Camera
        this.camera = new THREE.PerspectiveCamera(45, this.width / this.height, 0.1, 1000);
        this.camera.position.z = 5;

        // Renderer
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setSize(this.width, this.height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x000000, 0);
        this.container.appendChild(this.renderer.domElement);

        // Clock for animations
        this.clock = new THREE.Clock();

        // Mouse interaction
        this.mouse = new THREE.Vector2(0, 0);
        this.container.addEventListener('mousemove', (e) => {
            const rect = this.container.getBoundingClientRect();
            this.mouse.x = ((e.clientX - rect.left) / this.width) * 2 - 1;
            this.mouse.y = -((e.clientY - rect.top) / this.height) * 2 + 1;
        });
    }

    createOrb() {
        // NO SOLID SHELL - Pure ethereal particle-based AI orb
        // Store color uniforms for state changes (used by particle systems)
        this.stateColors = {
            c1: new THREE.Color(0x00ffff),
            c2: new THREE.Color(0x8b5cf6),
            c3: new THREE.Color(0xec4899)
        };

        // ===== ETHEREAL EDGE GLOW ONLY (no solid sphere) =====
        // Just a subtle edge glow ring - like Siri/Alexa style
        const edgeRingMaterial = new THREE.ShaderMaterial({
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vPosition;
                uniform float uTime;
                uniform float uAudioLevel;
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    vPosition = position;

                    // Subtle breathing
                    float breathe = 1.0 + sin(uTime * 2.0) * 0.02 + uAudioLevel * 0.05;
                    vec3 pos = position * breathe;

                    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                }
            `,
            fragmentShader: `
                varying vec3 vNormal;
                varying vec3 vPosition;
                uniform vec3 uColor1;
                uniform vec3 uColor2;
                uniform float uTime;
                uniform float uIntensity;
                uniform float uAudioLevel;

                void main() {
                    // Only show at extreme edges (high fresnel)
                    float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 4.0);

                    // Animate color around the edge
                    float angle = atan(vPosition.y, vPosition.x);
                    float wave = sin(angle * 3.0 + uTime * 2.0) * 0.5 + 0.5;
                    vec3 color = mix(uColor1, uColor2, wave);

                    // Audio reactive intensity
                    float intensity = fresnel * uIntensity * (0.8 + uAudioLevel * 0.5);

                    // Very transparent - just edge shimmer
                    float alpha = intensity * 0.4;

                    gl_FragColor = vec4(color, alpha);
                }
            `,
            uniforms: {
                uColor1: { value: new THREE.Color(0x00ffff) },
                uColor2: { value: new THREE.Color(0xec4899) },
                uTime: { value: 0 },
                uIntensity: { value: 0.8 },
                uAudioLevel: { value: 0 }
            },
            transparent: true,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const edgeGeometry = new THREE.SphereGeometry(0.95, 64, 64);
        this.edgeRing = new THREE.Mesh(edgeGeometry, edgeRingMaterial);
        this.scene.add(this.edgeRing);

        // ===== CREATE PARTICLE SYSTEMS =====
        this.createMeshBall();

        // ===== OUTER ATMOSPHERIC GLOW =====
        const glowMaterial = new THREE.ShaderMaterial({
            vertexShader: `
                varying vec3 vNormal;
                uniform float uTime;
                uniform float uAudioLevel;
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    float breathe = 1.0 + sin(uTime * 1.5) * 0.03 + uAudioLevel * 0.08;
                    vec3 pos = position * breathe;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                }
            `,
            fragmentShader: `
                varying vec3 vNormal;
                uniform vec3 uColor;
                uniform float uIntensity;
                void main() {
                    float intensity = pow(0.6 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
                    gl_FragColor = vec4(uColor, intensity * uIntensity * 0.5);
                }
            `,
            uniforms: {
                uColor: { value: new THREE.Color(0x00ffff) },
                uIntensity: { value: 0.7 },
                uTime: { value: 0 },
                uAudioLevel: { value: 0 }
            },
            transparent: true,
            side: THREE.BackSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const glowGeometry = new THREE.SphereGeometry(1.2, 32, 32);
        this.glow = new THREE.Mesh(glowGeometry, glowMaterial);
        this.scene.add(this.glow);
    }

    createMeshBall() {
        // High-resolution inner particle cloud - 8K quality plasma/nebula effect
        const innerParticleCount = 1200; // Increased for HD quality
        const innerPositions = new Float32Array(innerParticleCount * 3);
        const innerSizes = new Float32Array(innerParticleCount);
        const innerPhases = new Float32Array(innerParticleCount);
        const innerLayers = new Float32Array(innerParticleCount); // For layered coloring

        for (let i = 0; i < innerParticleCount; i++) {
            // Distribute in concentric layers with concentration toward center
            const layer = Math.random();
            const r = Math.pow(layer, 0.4) * 0.75; // More particles near center
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);

            innerPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            innerPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            innerPositions[i * 3 + 2] = r * Math.cos(phi);

            // Vary sizes for depth perception - smaller particles create finer detail
            innerSizes[i] = Math.random() * 0.06 + 0.015;
            innerPhases[i] = Math.random() * Math.PI * 2;
            innerLayers[i] = layer; // Store layer for color mixing
        }

        const innerGeometry = new THREE.BufferGeometry();
        innerGeometry.setAttribute('position', new THREE.BufferAttribute(innerPositions, 3));
        innerGeometry.setAttribute('size', new THREE.BufferAttribute(innerSizes, 1));
        innerGeometry.setAttribute('phase', new THREE.BufferAttribute(innerPhases, 1));
        innerGeometry.setAttribute('layer', new THREE.BufferAttribute(innerLayers, 1));

        this.innerCloudMaterial = new THREE.ShaderMaterial({
            vertexShader: `
                attribute float size;
                attribute float phase;
                attribute float layer;
                varying float vAlpha;
                varying float vLayer;
                varying float vDist;
                uniform float uTime;
                uniform float uAudioLevel;

                // High quality noise
                float hash(vec3 p) {
                    p = fract(p * 0.3183099 + vec3(0.1, 0.1, 0.1));
                    p *= 17.0;
                    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
                }

                float noise(vec3 p) {
                    vec3 i = floor(p);
                    vec3 f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);

                    return mix(
                        mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                            mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                        mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                            mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
                }

                float fbm(vec3 p) {
                    float value = 0.0;
                    float amplitude = 0.5;
                    for (int i = 0; i < 4; i++) {
                        value += amplitude * noise(p);
                        p *= 2.0;
                        amplitude *= 0.5;
                    }
                    return value;
                }

                void main() {
                    vLayer = layer;
                    vec3 pos = position;
                    float dist = length(position);
                    vDist = dist;

                    // ============================================
                    // ALWAYS-FLOWING ORGANIC CLOUD
                    // The cloud is ALIVE - constantly moving even when idle
                    // Audio makes it more energetic, not triggers it
                    // ============================================

                    // BASE time - always advancing at visible speed
                    float baseTime = uTime * 0.6;
                    // ACTIVE time - speeds up with audio
                    float activeTime = uTime * (0.6 + uAudioLevel * 0.5);

                    // === LAYER 1: GLOBAL DRIFT ===
                    // Large, slow, always-visible sweeping motion
                    // Like clouds drifting across the sky
                    float driftScale = 0.12 + uAudioLevel * 0.06;
                    vec3 globalDrift = vec3(
                        sin(baseTime * 0.4 + phase * 3.0 + dist * 2.0) * driftScale,
                        cos(baseTime * 0.35 + phase * 2.5 + layer * 4.0) * driftScale * 0.8,
                        sin(baseTime * 0.3 + phase * 2.0) * driftScale * 0.7
                    );
                    pos += globalDrift;

                    // === LAYER 2: SWIRLING FLOW FIELD ===
                    // Noise-based currents - always active, intensifies with audio
                    vec3 samplePos = position * 1.8 + baseTime * 0.5;
                    float nx = fbm(samplePos);
                    float ny = fbm(samplePos + vec3(31.416, 0.0, 0.0));
                    float nz = fbm(samplePos + vec3(0.0, 31.416, 0.0));

                    vec3 flow = vec3(nx - 0.5, ny - 0.5, nz - 0.5);
                    vec3 curl = cross(normalize(pos + vec3(0.001)), flow);

                    // Strong base flow - ALWAYS visible, stronger with audio
                    float flowStrength = 0.28 + uAudioLevel * 0.25;
                    float curlStrength = 0.18 + uAudioLevel * 0.2;

                    pos += flow * flowStrength * (0.6 + phase * 0.4);
                    pos += curl * curlStrength * (0.5 + layer * 0.5);

                    // === LAYER 3: INDIVIDUAL ORBITS ===
                    // Each particle traces its own elliptical path
                    float orbitSpeed = 0.6 + phase * 0.5 + uAudioLevel * 0.6;
                    float orbitPhase = activeTime * orbitSpeed + phase * 6.28;
                    float orbitSize = 0.055 + uAudioLevel * 0.06;

                    float ox = sin(orbitPhase) * orbitSize;
                    float oy = sin(orbitPhase * 1.4 + phase * 2.0) * orbitSize * 0.8;
                    float oz = cos(orbitPhase * 0.9 + phase) * orbitSize;

                    pos.x += ox * cos(phase * 3.14);
                    pos.y += oy;
                    pos.z += oz * sin(phase * 3.14);

                    // === LAYER 4: BREATHING EXPANSION ===
                    // Gentle radial pulsing - always breathing
                    float breathPhase = activeTime * 1.8 + phase * 6.28 + dist * 2.5;
                    float breathAmp = 0.09 * (0.8 + uAudioLevel * 0.4);
                    float breathe = sin(breathPhase) * breathAmp;
                    pos += normalize(pos + vec3(0.001)) * breathe;

                    // === LAYER 5: VORTEX SWIRL ===
                    // Differential rotation - inner and outer move differently
                    float vortexStrength = 0.08 + uAudioLevel * 0.12;
                    float vortexAngle = atan(pos.z, pos.x);
                    float vortexRadius = length(pos.xz);
                    // Velocity shear: particles at different distances rotate at different rates
                    float angularVel = (0.6 - dist) * vortexStrength * sin(baseTime + phase * 2.0);
                    vortexAngle += angularVel;

                    vec3 swirledPos = pos;
                    swirledPos.x = cos(vortexAngle) * vortexRadius;
                    swirledPos.z = sin(vortexAngle) * vortexRadius;

                    // Blend swirl with flow - more swirl toward center
                    float swirlBlend = 0.4 + (1.0 - dist) * 0.3 + uAudioLevel * 0.2;
                    pos.x = mix(pos.x, swirledPos.x, swirlBlend);
                    pos.z = mix(pos.z, swirledPos.z, swirlBlend);

                    // === LAYER 6: FINE TURBULENCE ===
                    // Small-scale organic jitter - always present
                    float jitter = 0.04 + uAudioLevel * 0.04;
                    float turbTime = activeTime * 2.0;
                    pos.x += (noise(pos * 6.0 + turbTime) - 0.5) * jitter;
                    pos.y += (noise(pos * 6.0 + turbTime + 50.0) - 0.5) * jitter;
                    pos.z += (noise(pos * 6.0 + turbTime + 100.0) - 0.5) * jitter;

                    // === LAYER 7: SECONDARY WAVE ===
                    // Additional sine wave motion for extra organic feel
                    float wave = sin(baseTime * 0.8 + dist * 5.0 + phase * 4.0) * 0.03;
                    float wave2 = cos(baseTime * 0.6 + layer * 6.0) * 0.025;
                    pos.x += wave * cos(phase * 6.28);
                    pos.y += wave2;
                    pos.z += wave * sin(phase * 6.28);

                    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);

                    // Size varies organically
                    float sizeMultiplier = 0.85 + (1.0 - dist) * 0.4;
                    sizeMultiplier *= 0.75 + layer * 0.45;
                    sizeMultiplier += uAudioLevel * 0.15;
                    gl_PointSize = size * (260.0 / -mvPosition.z) * sizeMultiplier;

                    // Alpha - always visible, brighter when active
                    vAlpha = 0.55 + uAudioLevel * 0.3;
                    vAlpha *= 0.65 + (1.0 - dist) * 0.45;

                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying float vAlpha;
                varying float vLayer;
                varying float vDist;
                uniform vec3 uColor1;
                uniform vec3 uColor2;
                uniform vec3 uColor3;
                uniform float uTime;

                void main() {
                    float dist = length(gl_PointCoord - vec2(0.5));
                    if (dist > 0.5) discard;

                    // Ultra-soft glow falloff for HD quality
                    float glow = smoothstep(0.5, 0.0, dist);
                    float innerGlow = smoothstep(0.25, 0.0, dist);
                    float coreGlow = smoothstep(0.1, 0.0, dist);

                    // Dynamic color mixing based on layer and time
                    float colorMix = vLayer + sin(uTime * 0.5 + vLayer * 6.28) * 0.2;
                    colorMix = clamp(colorMix, 0.0, 1.0);

                    vec3 color;
                    if (colorMix < 0.5) {
                        color = mix(uColor1, uColor2, colorMix * 2.0);
                    } else {
                        color = mix(uColor2, uColor3, (colorMix - 0.5) * 2.0);
                    }

                    // Add white hot core for particles near center
                    float whiteness = (1.0 - vDist) * 0.4 + coreGlow * 0.3;
                    color = mix(color, vec3(1.0), whiteness);

                    // Enhanced brightness in center of each particle
                    color += vec3(1.0) * innerGlow * 0.2;
                    color += color * coreGlow * 0.5;

                    float alpha = glow * vAlpha;
                    gl_FragColor = vec4(color, alpha);
                }
            `,
            uniforms: {
                uTime: { value: 0 },
                uAudioLevel: { value: 0 },
                uColor1: { value: new THREE.Color(0x00ffff) },
                uColor2: { value: new THREE.Color(0x8b5cf6) },
                uColor3: { value: new THREE.Color(0xec4899) }
            },
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.innerCloud = new THREE.Points(innerGeometry, this.innerCloudMaterial);
        this.scene.add(this.innerCloud);

        // === SECONDARY DETAIL LAYER - Finer particles for 8K effect ===
        const detailCount = 800;
        const detailPositions = new Float32Array(detailCount * 3);
        const detailSizes = new Float32Array(detailCount);
        const detailPhases = new Float32Array(detailCount);

        for (let i = 0; i < detailCount; i++) {
            const r = Math.pow(Math.random(), 0.6) * 0.6;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);

            detailPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            detailPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            detailPositions[i * 3 + 2] = r * Math.cos(phi);

            detailSizes[i] = Math.random() * 0.025 + 0.008; // Very small particles
            detailPhases[i] = Math.random() * Math.PI * 2;
        }

        const detailGeometry = new THREE.BufferGeometry();
        detailGeometry.setAttribute('position', new THREE.BufferAttribute(detailPositions, 3));
        detailGeometry.setAttribute('size', new THREE.BufferAttribute(detailSizes, 1));
        detailGeometry.setAttribute('phase', new THREE.BufferAttribute(detailPhases, 1));

        this.detailCloudMaterial = new THREE.ShaderMaterial({
            vertexShader: `
                attribute float size;
                attribute float phase;
                varying float vAlpha;
                uniform float uTime;
                uniform float uAudioLevel;

                // Simple noise for detail particles
                float hash(vec3 p) {
                    p = fract(p * 0.3183099 + vec3(0.1, 0.1, 0.1));
                    p *= 17.0;
                    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
                }

                float noise(vec3 p) {
                    vec3 i = floor(p);
                    vec3 f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    return mix(
                        mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                            mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                        mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                            mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
                }

                void main() {
                    vec3 pos = position;
                    float dist = length(position);

                    // ============================================
                    // ALWAYS-FLOWING DETAIL PARTICLES
                    // Faster, more chaotic than inner cloud
                    // ============================================

                    // BASE time - always moving visibly
                    float baseTime = uTime * 0.7;
                    // ACTIVE time - faster with audio
                    float activeTime = uTime * (0.7 + uAudioLevel * 0.8);

                    // === LAYER 1: DRIFT ===
                    float driftScale = 0.1 + uAudioLevel * 0.05;
                    vec3 drift = vec3(
                        sin(baseTime * 0.5 + phase * 4.0) * driftScale,
                        cos(baseTime * 0.45 + phase * 3.0) * driftScale * 0.7,
                        sin(baseTime * 0.4 + phase * 2.5) * driftScale * 0.6
                    );
                    pos += drift;

                    // === LAYER 2: FLOW FIELD ===
                    vec3 samplePos = position * 2.5 + baseTime * 0.6;
                    float nx = noise(samplePos);
                    float ny = noise(samplePos + vec3(17.0, 0.0, 0.0));
                    float nz = noise(samplePos + vec3(0.0, 17.0, 0.0));

                    vec3 flow = vec3(nx - 0.5, ny - 0.5, nz - 0.5);
                    float flowStrength = 0.25 + uAudioLevel * 0.35;

                    pos += flow * flowStrength * (0.6 + phase * 0.4);

                    // === LAYER 3: ORBITAL WOBBLE ===
                    float wobbleSpeed = 0.7 + phase * 0.5 + uAudioLevel * 0.8;
                    float wobblePhase = activeTime * wobbleSpeed + phase * 6.28;
                    float wobbleSize = 0.055 + uAudioLevel * 0.07;

                    pos.x += sin(wobblePhase) * wobbleSize * cos(phase * 3.14);
                    pos.y += sin(wobblePhase * 1.4 + phase) * wobbleSize * 0.7;
                    pos.z += cos(wobblePhase * 0.9) * wobbleSize * sin(phase * 3.14);

                    // === LAYER 4: BREATHING ===
                    float breathPhase = activeTime * 2.0 + phase * 6.28 + dist * 3.0;
                    float breathe = sin(breathPhase) * 0.07 * (0.85 + uAudioLevel * 0.3);
                    pos += normalize(pos + vec3(0.001)) * breathe;

                    // === LAYER 5: FINE TURBULENCE ===
                    float jitter = 0.045 + uAudioLevel * 0.05;
                    float turbTime = activeTime * 2.5;
                    pos += (vec3(noise(pos * 8.0 + turbTime),
                                 noise(pos * 8.0 + turbTime + 50.0),
                                 noise(pos * 8.0 + turbTime + 100.0)) - 0.5) * jitter;

                    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                    gl_PointSize = size * (180.0 / -mvPosition.z);

                    // Always visible, brighter with audio
                    vAlpha = 0.4 + uAudioLevel * 0.25;
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying float vAlpha;
                uniform vec3 uColor1;

                void main() {
                    float dist = length(gl_PointCoord - vec2(0.5));
                    if (dist > 0.5) discard;

                    float glow = smoothstep(0.5, 0.0, dist);
                    vec3 color = uColor1 + vec3(0.3);
                    gl_FragColor = vec4(color, glow * vAlpha * 0.6);
                }
            `,
            uniforms: {
                uTime: { value: 0 },
                uAudioLevel: { value: 0 },
                uColor1: { value: new THREE.Color(0x00ffff) }
            },
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.detailCloud = new THREE.Points(detailGeometry, this.detailCloudMaterial);
        this.scene.add(this.detailCloud);

        // === CENTRAL BRIGHT CORE - Multi-layered for intensity ===
        const coreGeometry = new THREE.BufferGeometry();
        coreGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));

        this.coreMaterial = new THREE.ShaderMaterial({
            vertexShader: `
                uniform float uTime;
                uniform float uAudioLevel;
                varying float vIntensity;

                // Smooth easing function for curved oscillation
                float smoothPulse(float t) {
                    float s = sin(t);
                    // Cubic easing for smoother curves at peaks
                    return s * s * s * sign(s) * 0.5 + s * 0.5;
                }

                void main() {
                    // SLOW, smooth pulsing - single gentle wave
                    float slowTime = uTime * 0.4;
                    float basePulse = smoothPulse(slowTime) * 0.08;
                    float audioPulse = uAudioLevel * 0.25;
                    vIntensity = 0.9 + basePulse + audioPulse;

                    // Core size - ONE slow smooth wave, not multiple interfering
                    float sizeWave = smoothPulse(uTime * 0.5) * 8.0;
                    float baseSize = 95.0 + sizeWave;
                    float audioSize = uAudioLevel * 35.0;

                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = (baseSize + audioSize) / -mvPosition.z;
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying float vIntensity;
                uniform vec3 uColor1;
                uniform vec3 uColor2;
                uniform float uTime;

                void main() {
                    float dist = length(gl_PointCoord - vec2(0.5));
                    if (dist > 0.5) discard;

                    // Multiple glow layers for intense core
                    float glow1 = smoothstep(0.5, 0.0, dist);
                    float glow2 = smoothstep(0.35, 0.0, dist);
                    float glow3 = smoothstep(0.2, 0.0, dist);
                    float glow4 = smoothstep(0.08, 0.0, dist);

                    // SLOW color transition - 8 second cycle
                    float colorMix = sin(uTime * 0.25) * 0.5 + 0.5;
                    vec3 baseColor = mix(uColor1, uColor2, colorMix);

                    vec3 color = baseColor * glow1 * 0.4;
                    color += mix(baseColor, vec3(1.0), 0.5) * glow2 * 0.3;
                    color += vec3(1.0) * glow3 * 0.4;
                    color += vec3(1.0) * glow4 * 0.6;

                    float alpha = glow1 * vIntensity;
                    gl_FragColor = vec4(color, alpha);
                }
            `,
            uniforms: {
                uTime: { value: 0 },
                uAudioLevel: { value: 0 },
                uColor1: { value: new THREE.Color(0x00ffff) },
                uColor2: { value: new THREE.Color(0xec4899) }
            },
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.corePoint = new THREE.Points(coreGeometry, this.coreMaterial);
        this.scene.add(this.corePoint);
    }

    createParticles() {
        const particleCount = 200;
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);
        const speeds = new Float32Array(particleCount);

        const colorPalette = [
            new THREE.Color(0x00ffff), // Cyan
            new THREE.Color(0x8b5cf6), // Purple
            new THREE.Color(0xec4899), // Pink
            new THREE.Color(0xffffff)  // White
        ];

        for (let i = 0; i < particleCount; i++) {
            // Distribute particles in a sphere
            const radius = 1.5 + Math.random() * 1.5;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);

            positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
            positions[i * 3 + 2] = radius * Math.cos(phi);

            // Random color from palette
            const color = colorPalette[Math.floor(Math.random() * colorPalette.length)];
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;

            sizes[i] = Math.random() * 0.08 + 0.02;
            speeds[i] = Math.random() * 0.5 + 0.5;
        }

        const particleGeometry = new THREE.BufferGeometry();
        particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        particleGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        particleGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        this.particleSpeeds = speeds;
        this.particlePositions = positions;

        const particleMaterial = new THREE.ShaderMaterial({
            vertexShader: `
                attribute float size;
                attribute vec3 color;
                varying vec3 vColor;
                uniform float uTime;
                uniform float uAudioLevel;

                void main() {
                    vColor = color;
                    vec3 pos = position;

                    // Orbit animation
                    float angle = uTime * 0.3;
                    float s = sin(angle);
                    float c = cos(angle);
                    pos.xz = mat2(c, -s, s, c) * pos.xz;

                    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                    gl_PointSize = size * (300.0 / -mvPosition.z) * (1.0 + uAudioLevel * 0.5);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                void main() {
                    float dist = length(gl_PointCoord - vec2(0.5));
                    if (dist > 0.5) discard;
                    float alpha = 1.0 - smoothstep(0.3, 0.5, dist);
                    gl_FragColor = vec4(vColor, alpha);
                }
            `,
            uniforms: {
                uTime: { value: 0 },
                uAudioLevel: { value: 0 }
            },
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.particles = new THREE.Points(particleGeometry, particleMaterial);
        this.scene.add(this.particles);
    }

    createAura() {
        // Outer aura ring
        const auraGeometry = new THREE.RingGeometry(1.8, 2.5, 64);
        const auraMaterial = new THREE.ShaderMaterial({
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                varying vec2 vUv;
                uniform float uTime;
                uniform vec3 uColor1;
                uniform vec3 uColor2;

                void main() {
                    float angle = atan(vUv.y - 0.5, vUv.x - 0.5);
                    float wave = sin(angle * 8.0 + uTime * 3.0) * 0.5 + 0.5;

                    vec3 color = mix(uColor1, uColor2, wave);
                    float alpha = (1.0 - abs(vUv.x - 0.5) * 2.0) * 0.3 * wave;

                    gl_FragColor = vec4(color, alpha);
                }
            `,
            uniforms: {
                uTime: { value: 0 },
                uColor1: { value: new THREE.Color(0x00ffff) },
                uColor2: { value: new THREE.Color(0xec4899) }
            },
            transparent: true,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending
        });

        this.aura = new THREE.Mesh(auraGeometry, auraMaterial);
        this.scene.add(this.aura);
    }

    setState(state) {
        this.state = state;

        // Update colors based on state for ALL particle systems
        const colors = {
            idle: {
                c1: new THREE.Color(0x00ffff),
                c2: new THREE.Color(0x8b5cf6),
                c3: new THREE.Color(0xec4899)
            },
            listening: {
                c1: new THREE.Color(0x00ffff),
                c2: new THREE.Color(0x00ccff),
                c3: new THREE.Color(0x0088ff)
            },
            speaking: {
                c1: new THREE.Color(0xec4899),
                c2: new THREE.Color(0xff6b9d),
                c3: new THREE.Color(0xff8fab)
            },
            thinking: {
                c1: new THREE.Color(0x8b5cf6),
                c2: new THREE.Color(0xa78bfa),
                c3: new THREE.Color(0xc4b5fd)
            }
        };

        const stateColors = colors[state] || colors.idle;
        this.stateColors = stateColors;

        // Update inner particle cloud colors
        if (this.innerCloudMaterial) {
            this.innerCloudMaterial.uniforms.uColor1.value = stateColors.c1;
            this.innerCloudMaterial.uniforms.uColor2.value = stateColors.c2;
            this.innerCloudMaterial.uniforms.uColor3.value = stateColors.c3;
        }

        // Update detail cloud color
        if (this.detailCloudMaterial) {
            this.detailCloudMaterial.uniforms.uColor1.value = stateColors.c1;
        }

        // Update core point colors
        if (this.coreMaterial) {
            this.coreMaterial.uniforms.uColor1.value = stateColors.c1;
            this.coreMaterial.uniforms.uColor2.value = stateColors.c3;
        }

        // Update edge ring colors
        if (this.edgeRing && this.edgeRing.material) {
            this.edgeRing.material.uniforms.uColor1.value = stateColors.c1;
            this.edgeRing.material.uniforms.uColor2.value = stateColors.c3;
        }

        // Update outer glow color
        if (this.glow && this.glow.material) {
            this.glow.material.uniforms.uColor.value = stateColors.c1;
        }

        // Update aura colors
        if (this.aura && this.aura.material) {
            this.aura.material.uniforms.uColor1.value = stateColors.c1;
            this.aura.material.uniforms.uColor2.value = stateColors.c3;
        }
    }

    setAudioLevel(level) {
        this.audioLevel = Math.min(1, Math.max(0, level));
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const time = this.clock.getElapsedTime();

        // Smooth audio level transition
        const targetAudio = this.audioLevel;
        if (!this._smoothedAudio) this._smoothedAudio = 0;
        this._smoothedAudio += (targetAudio - this._smoothedAudio) * 0.1;
        const smoothedAudio = this._smoothedAudio;

        // ============================================
        // CALM, SMOOTH BREATHING
        // Single slow wave with eased curves - no sharp turns
        // ============================================

        // Single smooth sine wave - slow and gentle
        const breathPhase = time * 0.5; // ~12 second full cycle
        const rawBreath = Math.sin(breathPhase);
        // Ease the sine for smoother peaks (cubic smoothing)
        const easedBreath = rawBreath * Math.abs(rawBreath) * 0.5 + rawBreath * 0.5;
        const baseBreath = easedBreath * 0.025; // Subtle amplitude

        // Audio adds gentle expansion
        const audioBreath = smoothedAudio * 0.08;
        const globalScale = 1.0 + baseBreath + audioBreath;

        // ===== UPDATE INNER PARTICLE CLOUD =====
        if (this.innerCloud && this.innerCloudMaterial) {
            this.innerCloudMaterial.uniforms.uTime.value = time;
            this.innerCloudMaterial.uniforms.uAudioLevel.value = smoothedAudio;

            // Global breathing scale on top of shader's internal flow
            this.innerCloud.scale.setScalar(globalScale);

            // Subtle mouse tilt for interactivity
            this.innerCloud.rotation.x = this.mouse.y * 0.06;
            this.innerCloud.rotation.z = this.mouse.x * -0.03;
        }

        // ===== UPDATE DETAIL PARTICLE CLOUD =====
        if (this.detailCloud && this.detailCloudMaterial) {
            this.detailCloudMaterial.uniforms.uTime.value = time;
            this.detailCloudMaterial.uniforms.uAudioLevel.value = smoothedAudio;

            // Offset phase for layered depth - same smooth curve
            const detailPhase = time * 0.5 + 1.0;
            const detailRaw = Math.sin(detailPhase);
            const detailEased = detailRaw * Math.abs(detailRaw) * 0.5 + detailRaw * 0.5;
            const detailScale = 1.0 + detailEased * 0.02 + audioBreath * 0.7;
            this.detailCloud.scale.setScalar(detailScale);

            // Parallax tilt
            this.detailCloud.rotation.x = this.mouse.y * 0.05;
            this.detailCloud.rotation.z = this.mouse.x * -0.025;
        }

        // ===== UPDATE CENTRAL CORE POINT =====
        if (this.corePoint && this.coreMaterial) {
            this.coreMaterial.uniforms.uTime.value = time;
            this.coreMaterial.uniforms.uAudioLevel.value = smoothedAudio;

            // Core has its own smooth pulsing via shader
            // Just sync with global scale subtly
            const coreScale = 1.0 + baseBreath * 0.4 + audioBreath * 0.6;
            this.corePoint.scale.setScalar(coreScale);
        }

        // ===== UPDATE EDGE RING =====
        if (this.edgeRing && this.edgeRing.material) {
            this.edgeRing.material.uniforms.uTime.value = time;
            this.edgeRing.material.uniforms.uAudioLevel.value = smoothedAudio;

            // Edge ring breathes smoothly with the orb
            const edgeScale = 1.0 + baseBreath * 0.6 + audioBreath * 0.5;
            this.edgeRing.scale.setScalar(edgeScale);

            // Very slow rotation for shimmer effect
            this.edgeRing.rotation.y = time * 0.03;
        }

        // ===== UPDATE OUTER PARTICLES =====
        if (this.particles && this.particles.material) {
            this.particles.material.uniforms.uTime.value = time;
            this.particles.material.uniforms.uAudioLevel.value = smoothedAudio;
        }

        // ===== UPDATE OUTER GLOW =====
        if (this.glow && this.glow.material) {
            // Glow intensity - slow smooth pulse
            const glowPhase = time * 0.4;
            const glowPulse = Math.sin(glowPhase) * 0.08;
            const glowIntensity = 0.55 + glowPulse + smoothedAudio * 0.3;
            this.glow.material.uniforms.uIntensity.value = glowIntensity;
            this.glow.material.uniforms.uTime.value = time;
            this.glow.material.uniforms.uAudioLevel.value = smoothedAudio;

            // Glow expands with breathing
            const glowScale = 1.0 + baseBreath * 0.8 + audioBreath * 0.9;
            this.glow.scale.setScalar(glowScale);
        }

        // ===== UPDATE AURA RING =====
        if (this.aura && this.aura.material) {
            this.aura.material.uniforms.uTime.value = time;
            // Very slow rotation
            this.aura.rotation.z = time * 0.1;

            // Aura syncs with global breathing
            const auraScale = 1.0 + baseBreath * 0.5 + smoothedAudio * 0.1;
            this.aura.scale.setScalar(auraScale);
        }

        this.renderer.render(this.scene, this.camera);
    }

    onResize() {
        this.width = this.container.offsetWidth;
        this.height = this.container.offsetHeight;

        this.camera.aspect = this.width / this.height;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(this.width, this.height);
    }

    dispose() {
        this.renderer.dispose();
        this.scene.clear();
        if (this.container.contains(this.renderer.domElement)) {
            this.container.removeChild(this.renderer.domElement);
        }
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Wait for Three.js to be available
    function initOrb() {
        if (typeof THREE === 'undefined') {
            setTimeout(initOrb, 50);
            return;
        }

        const avatarContainer = document.getElementById('aiAvatar');
        if (avatarContainer) {
            // Clear any existing content using safe DOM methods
            while (avatarContainer.firstChild) {
                avatarContainer.removeChild(avatarContainer.firstChild);
            }

            // Create WebGL orb
            window.neonOrb = new NeonOrb('aiAvatar');
        }
    }

    initOrb();
});
