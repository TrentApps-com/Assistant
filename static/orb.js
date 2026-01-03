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
        // Core orb shader material
        const orbVertexShader = `
            varying vec2 vUv;
            varying vec3 vNormal;
            varying vec3 vPosition;
            uniform float uTime;
            uniform float uAudioLevel;

            void main() {
                vUv = uv;
                vNormal = normalize(normalMatrix * normal);
                vPosition = position;

                // Subtle breathing distortion
                float breathe = sin(uTime * 2.0) * 0.02 + sin(uTime * 3.7) * 0.01;
                float audioDistort = uAudioLevel * 0.1;
                vec3 newPosition = position * (1.0 + breathe + audioDistort);

                // Add noise-based distortion
                float noise = sin(position.x * 10.0 + uTime) * sin(position.y * 10.0 + uTime) * 0.02;
                newPosition += normal * noise * (1.0 + uAudioLevel);

                gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
            }
        `;

        const orbFragmentShader = `
            varying vec2 vUv;
            varying vec3 vNormal;
            varying vec3 vPosition;
            uniform float uTime;
            uniform float uAudioLevel;
            uniform vec3 uColor1;
            uniform vec3 uColor2;
            uniform vec3 uColor3;

            // Noise functions
            float random(vec2 st) {
                return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
            }

            float noise(vec2 st) {
                vec2 i = floor(st);
                vec2 f = fract(st);
                float a = random(i);
                float b = random(i + vec2(1.0, 0.0));
                float c = random(i + vec2(0.0, 1.0));
                float d = random(i + vec2(1.0, 1.0));
                vec2 u = f * f * (3.0 - 2.0 * f);
                return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
            }

            void main() {
                // Fresnel effect for edge glow
                vec3 viewDirection = normalize(cameraPosition - vPosition);
                float fresnel = pow(1.0 - dot(viewDirection, vNormal), 3.0);

                // Animated color mixing
                float t = uTime * 0.5;
                float n = noise(vUv * 3.0 + t);

                // Dynamic color gradient
                vec3 color = mix(uColor1, uColor2, n);
                color = mix(color, uColor3, fresnel * 0.5);

                // Core glow
                float core = 1.0 - length(vUv - 0.5) * 2.0;
                core = smoothstep(0.0, 1.0, core);
                color += vec3(1.0) * core * 0.3;

                // Animated swirl patterns
                float angle = atan(vUv.y - 0.5, vUv.x - 0.5);
                float swirl = sin(angle * 5.0 + uTime * 2.0 + n * 6.28) * 0.5 + 0.5;
                color += uColor1 * swirl * 0.2 * (1.0 + uAudioLevel);

                // Edge glow
                float alpha = 0.85 + fresnel * 0.15;
                color += (uColor2 + uColor3) * 0.5 * fresnel * (0.5 + uAudioLevel * 0.5);

                gl_FragColor = vec4(color, alpha);
            }
        `;

        this.orbMaterial = new THREE.ShaderMaterial({
            vertexShader: orbVertexShader,
            fragmentShader: orbFragmentShader,
            uniforms: {
                uTime: { value: 0 },
                uAudioLevel: { value: 0 },
                uColor1: { value: new THREE.Color(0x00ffff) }, // Cyan
                uColor2: { value: new THREE.Color(0x8b5cf6) }, // Purple
                uColor3: { value: new THREE.Color(0xec4899) }  // Pink
            },
            transparent: true,
            side: THREE.DoubleSide
        });

        const orbGeometry = new THREE.SphereGeometry(1, 64, 64);
        this.orb = new THREE.Mesh(orbGeometry, this.orbMaterial);
        this.scene.add(this.orb);

        // Inner glow orb
        const glowMaterial = new THREE.ShaderMaterial({
            vertexShader: `
                varying vec3 vNormal;
                void main() {
                    vNormal = normalize(normalMatrix * normal);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                varying vec3 vNormal;
                uniform vec3 uColor;
                uniform float uIntensity;
                void main() {
                    float intensity = pow(0.7 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
                    gl_FragColor = vec4(uColor, intensity * uIntensity);
                }
            `,
            uniforms: {
                uColor: { value: new THREE.Color(0x00ffff) },
                uIntensity: { value: 0.8 }
            },
            transparent: true,
            side: THREE.BackSide,
            blending: THREE.AdditiveBlending
        });

        const glowGeometry = new THREE.SphereGeometry(1.2, 32, 32);
        this.glow = new THREE.Mesh(glowGeometry, glowMaterial);
        this.scene.add(this.glow);
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

        // Update colors based on state
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
        this.orbMaterial.uniforms.uColor1.value = stateColors.c1;
        this.orbMaterial.uniforms.uColor2.value = stateColors.c2;
        this.orbMaterial.uniforms.uColor3.value = stateColors.c3;
    }

    setAudioLevel(level) {
        this.audioLevel = Math.min(1, Math.max(0, level));
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const time = this.clock.getElapsedTime();

        // Smooth audio level transition
        const targetAudio = this.audioLevel;
        const currentAudio = this.orbMaterial.uniforms.uAudioLevel.value;
        this.orbMaterial.uniforms.uAudioLevel.value += (targetAudio - currentAudio) * 0.1;

        // Update uniforms
        this.orbMaterial.uniforms.uTime.value = time;
        this.particles.material.uniforms.uTime.value = time;
        this.particles.material.uniforms.uAudioLevel.value = this.orbMaterial.uniforms.uAudioLevel.value;
        this.aura.material.uniforms.uTime.value = time;

        // Rotate orb subtly
        this.orb.rotation.y = time * 0.2;
        this.orb.rotation.x = Math.sin(time * 0.5) * 0.1;

        // Pulse glow
        const glowIntensity = 0.6 + Math.sin(time * 2) * 0.2 + this.audioLevel * 0.3;
        this.glow.material.uniforms.uIntensity.value = glowIntensity;

        // Rotate aura
        this.aura.rotation.z = time * 0.5;

        // Mouse interaction - subtle follow
        this.orb.rotation.x += this.mouse.y * 0.02;
        this.orb.rotation.y += this.mouse.x * 0.02;

        // State-specific animations
        if (this.state === 'speaking') {
            this.orb.scale.setScalar(1 + Math.sin(time * 15) * 0.05 + this.audioLevel * 0.1);
        } else if (this.state === 'listening') {
            this.orb.scale.setScalar(1 + Math.sin(time * 3) * 0.03);
        } else if (this.state === 'thinking') {
            this.orb.rotation.y = time * 0.5;
        } else {
            this.orb.scale.setScalar(1 + Math.sin(time * 1.5) * 0.02);
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
