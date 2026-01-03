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

                    // === AUDIO-REACTIVE STIRRING ===
                    // Base rotation speed increases dramatically with audio
                    float baseSpeed = 0.3;
                    float activeSpeed = baseSpeed + uAudioLevel * 2.5; // Much faster when active

                    // Swirl angle - faster rotation when audio is present
                    float angle = uTime * activeSpeed + phase;
                    float r = length(position.xz);
                    float swirl = angle + r * (2.0 + uAudioLevel * 4.0) + layer * 2.0;

                    // Primary rotation - speed scales with audio
                    float rotSpeed1 = 0.2 + uAudioLevel * 0.8;
                    float s1 = sin(swirl * rotSpeed1);
                    float c1 = cos(swirl * rotSpeed1);
                    pos.xz = mat2(c1, -s1, s1, c1) * pos.xz;

                    // Secondary rotation on different axis - creates tumbling
                    float rotSpeed2 = 0.15 + uAudioLevel * 0.6;
                    float s2 = sin(swirl * rotSpeed2 + 1.57);
                    float c2 = cos(swirl * rotSpeed2 + 1.57);
                    pos.xy = mat2(c2, -s2, s2, c2) * pos.xy;

                    // Third axis rotation for full 3D stirring when active
                    float rotSpeed3 = uAudioLevel * 0.5;
                    float s3 = sin(uTime * 1.5 + phase * 2.0);
                    float c3 = cos(uTime * 1.5 + phase * 2.0);
                    pos.yz = mat2(c3, -s3 * rotSpeed3, s3 * rotSpeed3, c3) * pos.yz;

                    // === OUTWARD EXPANSION when active ===
                    // Particles push outward from center based on audio
                    float expansion = 1.0 + uAudioLevel * 0.4; // Expand cloud radius
                    // Inner particles expand more than outer ones (creates stirring effect)
                    float innerExpansion = (1.0 - dist) * uAudioLevel * 0.3;
                    pos *= expansion + innerExpansion;

                    // === ORBITAL DRIFT ===
                    // Particles drift in elliptical paths when active
                    float orbitPhase = uTime * (0.5 + uAudioLevel * 2.0) + phase * 6.28;
                    float orbitRadius = 0.05 + uAudioLevel * 0.15;
                    pos.x += sin(orbitPhase) * orbitRadius * (1.0 - layer);
                    pos.z += cos(orbitPhase * 1.3) * orbitRadius * (1.0 - layer);
                    pos.y += sin(orbitPhase * 0.7 + phase) * orbitRadius * 0.5;

                    // === TURBULENT DISPLACEMENT ===
                    // More chaotic displacement when audio is high
                    float turbulenceStrength = 0.1 + uAudioLevel * 0.4;
                    vec3 noisePos = pos * 3.0 + uTime * (0.3 + uAudioLevel * 1.5);
                    float n = fbm(noisePos);
                    vec3 displacement = normalize(pos + vec3(0.001)) * (n - 0.5) * turbulenceStrength;
                    pos += displacement;

                    // Subtle vertical wave
                    pos.y += sin(uTime * 1.5 + phase * 4.0 + dist * 5.0) * 0.03;

                    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);

                    // Size - slightly smaller when expanded to maintain density look
                    float sizeMultiplier = 1.0 + (1.0 - dist) * 0.6;
                    sizeMultiplier *= 0.7 + layer * 0.5;
                    gl_PointSize = size * (260.0 / -mvPosition.z) * sizeMultiplier;

                    // Alpha - brighter when active
                    vAlpha = 0.5 + uAudioLevel * 0.4;
                    vAlpha *= 0.6 + (1.0 - dist) * 0.5;

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

                void main() {
                    vec3 pos = position;

                    // === CHAOTIC STIRRING - faster and more intense than main cloud ===
                    float activeSpeed = 0.6 + uAudioLevel * 3.0;
                    float angle = uTime * activeSpeed + phase * 2.0;

                    // Multi-axis rotation for chaotic tumbling
                    float s = sin(angle * 0.4);
                    float c = cos(angle * 0.4);
                    pos.xz = mat2(c, -s, s, c) * pos.xz;

                    float s2 = sin(angle * 0.3 + 1.0);
                    float c2 = cos(angle * 0.3 + 1.0);
                    pos.yz = mat2(c2, s2, -s2, c2) * pos.yz;

                    // Third axis when active
                    float s3 = sin(uTime * 2.0 + phase);
                    float c3 = cos(uTime * 2.0 + phase);
                    pos.xy = mat2(c3, -s3 * uAudioLevel, s3 * uAudioLevel, c3) * pos.xy;

                    // Expansion outward
                    float expansion = 1.0 + uAudioLevel * 0.5;
                    pos *= expansion;

                    // Orbital wobble
                    float orbitPhase = uTime * (1.0 + uAudioLevel * 3.0) + phase * 6.28;
                    pos.x += sin(orbitPhase) * 0.08 * uAudioLevel;
                    pos.z += cos(orbitPhase * 1.5) * 0.08 * uAudioLevel;
                    pos.y += sin(orbitPhase * 0.8) * 0.05 * uAudioLevel;

                    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                    gl_PointSize = size * (180.0 / -mvPosition.z);

                    vAlpha = 0.35 + uAudioLevel * 0.35;
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

                void main() {
                    vIntensity = 0.9 + uAudioLevel * 0.5 + sin(uTime * 6.0) * 0.1;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = (100.0 + uAudioLevel * 60.0) / -mvPosition.z;
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

                    // Pulsing color mix
                    float colorMix = sin(uTime * 2.0) * 0.5 + 0.5;
                    vec3 baseColor = mix(uColor1, uColor2, colorMix);

                    vec3 color = baseColor * glow1 * 0.4;
                    color += mix(baseColor, vec3(1.0), 0.5) * glow2 * 0.3;
                    color += vec3(1.0) * glow3 * 0.4;
                    color += vec3(1.0) * glow4 * 0.6; // Bright white center

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

        // ===== UPDATE INNER PARTICLE CLOUD =====
        if (this.innerCloud && this.innerCloudMaterial) {
            this.innerCloudMaterial.uniforms.uTime.value = time;
            this.innerCloudMaterial.uniforms.uAudioLevel.value = smoothedAudio;
            this.innerCloud.rotation.y = time * 0.15;
            this.innerCloud.rotation.x = Math.sin(time * 0.3) * 0.1;
        }

        // ===== UPDATE DETAIL PARTICLE CLOUD =====
        if (this.detailCloud && this.detailCloudMaterial) {
            this.detailCloudMaterial.uniforms.uTime.value = time;
            this.detailCloudMaterial.uniforms.uAudioLevel.value = smoothedAudio;
            this.detailCloud.rotation.y = -time * 0.2;
            this.detailCloud.rotation.z = time * 0.1;
        }

        // ===== UPDATE CENTRAL CORE POINT =====
        if (this.corePoint && this.coreMaterial) {
            this.coreMaterial.uniforms.uTime.value = time;
            this.coreMaterial.uniforms.uAudioLevel.value = smoothedAudio;
        }

        // ===== UPDATE EDGE RING =====
        if (this.edgeRing && this.edgeRing.material) {
            this.edgeRing.material.uniforms.uTime.value = time;
            this.edgeRing.material.uniforms.uAudioLevel.value = smoothedAudio;
            this.edgeRing.rotation.y = time * 0.1;
            this.edgeRing.rotation.x = Math.sin(time * 0.5) * 0.05;
        }

        // ===== UPDATE OUTER PARTICLES =====
        if (this.particles && this.particles.material) {
            this.particles.material.uniforms.uTime.value = time;
            this.particles.material.uniforms.uAudioLevel.value = smoothedAudio;
        }

        // ===== UPDATE OUTER GLOW =====
        if (this.glow && this.glow.material) {
            const glowIntensity = 0.5 + Math.sin(time * 2) * 0.15 + smoothedAudio * 0.4;
            this.glow.material.uniforms.uIntensity.value = glowIntensity;
            this.glow.material.uniforms.uTime.value = time;
            this.glow.material.uniforms.uAudioLevel.value = smoothedAudio;
        }

        // ===== UPDATE AURA RING =====
        if (this.aura && this.aura.material) {
            this.aura.material.uniforms.uTime.value = time;
            this.aura.rotation.z = time * 0.5;
        }

        // ===== STATE-SPECIFIC BASE ROTATION =====
        // Shaders handle the stirring/expansion via uAudioLevel
        // Just add gentle base rotation here for variety
        if (this.innerCloud) {
            // Thinking state gets faster base rotation
            if (this.state === 'thinking') {
                this.innerCloud.rotation.y = time * 0.3;
            }
            // Mouse interaction - subtle follow
            this.innerCloud.rotation.x += this.mouse.y * 0.008;
            this.innerCloud.rotation.y += this.mouse.x * 0.008;
        }

        if (this.detailCloud) {
            // Counter-rotate detail cloud for depth
            this.detailCloud.rotation.x += this.mouse.y * -0.005;
            this.detailCloud.rotation.z += this.mouse.x * 0.005;
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
