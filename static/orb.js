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
        // Enhanced core orb shader material with high internal detail
        const orbVertexShader = `
            varying vec2 vUv;
            varying vec3 vNormal;
            varying vec3 vPosition;
            varying vec3 vWorldPosition;
            uniform float uTime;
            uniform float uAudioLevel;

            void main() {
                vUv = uv;
                vNormal = normalize(normalMatrix * normal);
                vPosition = position;
                vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;

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
            varying vec3 vWorldPosition;
            uniform float uTime;
            uniform float uAudioLevel;
            uniform vec3 uColor1;
            uniform vec3 uColor2;
            uniform vec3 uColor3;

            // ===== NOISE FUNCTIONS =====
            float hash(float n) { return fract(sin(n) * 43758.5453123); }
            float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
            float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123); }

            // 3D Simplex-like noise
            float noise3D(vec3 p) {
                vec3 i = floor(p);
                vec3 f = fract(p);
                f = f * f * (3.0 - 2.0 * f);

                float n = i.x + i.y * 157.0 + 113.0 * i.z;
                return mix(
                    mix(mix(hash(n + 0.0), hash(n + 1.0), f.x),
                        mix(hash(n + 157.0), hash(n + 158.0), f.x), f.y),
                    mix(mix(hash(n + 113.0), hash(n + 114.0), f.x),
                        mix(hash(n + 270.0), hash(n + 271.0), f.x), f.y), f.z);
            }

            // Fractal Brownian Motion - multiple octaves for detail
            float fbm(vec3 p, int octaves) {
                float value = 0.0;
                float amplitude = 0.5;
                float frequency = 1.0;
                float total = 0.0;

                for (int i = 0; i < 8; i++) {
                    if (i >= octaves) break;
                    value += amplitude * noise3D(p * frequency);
                    total += amplitude;
                    amplitude *= 0.5;
                    frequency *= 2.0;
                }
                return value / total;
            }

            // Turbulent noise
            float turbulence(vec3 p, int octaves) {
                float value = 0.0;
                float amplitude = 0.5;
                float frequency = 1.0;

                for (int i = 0; i < 6; i++) {
                    if (i >= octaves) break;
                    value += amplitude * abs(noise3D(p * frequency) * 2.0 - 1.0);
                    amplitude *= 0.5;
                    frequency *= 2.0;
                }
                return value;
            }

            // Voronoi/cellular noise for organic patterns
            vec2 voronoi(vec3 p) {
                vec3 i = floor(p);
                vec3 f = fract(p);

                float minDist = 1.0;
                float secondMin = 1.0;

                for (int x = -1; x <= 1; x++) {
                    for (int y = -1; y <= 1; y++) {
                        for (int z = -1; z <= 1; z++) {
                            vec3 neighbor = vec3(float(x), float(y), float(z));
                            vec3 point = neighbor + hash3(i + neighbor) - f;
                            float d = dot(point, point);

                            if (d < minDist) {
                                secondMin = minDist;
                                minDist = d;
                            } else if (d < secondMin) {
                                secondMin = d;
                            }
                        }
                    }
                }
                return vec2(sqrt(minDist), sqrt(secondMin));
            }

            // Domain warping for fluid-like distortion
            vec3 domainWarp(vec3 p, float t) {
                vec3 q = vec3(
                    fbm(p + vec3(0.0, 0.0, 0.0) + t * 0.1, 4),
                    fbm(p + vec3(5.2, 1.3, 2.8) + t * 0.15, 4),
                    fbm(p + vec3(2.1, 3.7, 1.2) + t * 0.12, 4)
                );
                return p + q * 0.5;
            }

            void main() {
                // View and fresnel calculations
                vec3 viewDirection = normalize(cameraPosition - vPosition);
                float fresnel = pow(1.0 - max(dot(viewDirection, vNormal), 0.0), 3.0);
                float rim = pow(1.0 - max(dot(viewDirection, vNormal), 0.0), 2.0);

                // Spherical UV for internal mapping
                vec3 spherePos = normalize(vPosition);
                float phi = atan(spherePos.z, spherePos.x);
                float theta = acos(spherePos.y);
                vec2 sphereUv = vec2(phi / 6.28318 + 0.5, theta / 3.14159);

                // Time variables for animation
                float t = uTime * 0.3;
                float tFast = uTime * 0.8;
                float tSlow = uTime * 0.15;

                // ===== LAYER 1: Deep Core Energy =====
                vec3 corePos = vPosition * 3.0 + vec3(0.0, t * 0.5, 0.0);
                float coreEnergy = fbm(corePos, 6);
                coreEnergy = pow(coreEnergy, 1.5);

                // ===== LAYER 2: Plasma Flows =====
                vec3 plasmaPos = domainWarp(vPosition * 2.0, tFast);
                float plasma = fbm(plasmaPos, 5);
                plasma = smoothstep(0.3, 0.7, plasma);

                // ===== LAYER 3: Energy Veins/Streams =====
                vec3 veinPos = vPosition * 4.0 + vec3(sin(t), cos(t * 0.7), sin(t * 1.3)) * 0.3;
                vec2 veinVoronoi = voronoi(veinPos);
                float veins = smoothstep(0.0, 0.15, veinVoronoi.y - veinVoronoi.x);
                veins *= 1.0 - smoothstep(0.0, 0.3, veinVoronoi.x);

                // ===== LAYER 4: Turbulent Nebula =====
                vec3 nebulaPos = vPosition * 1.5 + vec3(tSlow, tSlow * 0.7, tSlow * 1.2);
                float nebula = turbulence(nebulaPos, 5);

                // ===== LAYER 5: Fine Detail Noise =====
                vec3 detailPos = vPosition * 8.0 + vec3(t * 2.0);
                float detail = noise3D(detailPos) * 0.5 + 0.5;
                detail = pow(detail, 2.0);

                // ===== LAYER 6: Swirling Vortex =====
                float angle = atan(vPosition.z, vPosition.x);
                float radius = length(vPosition.xz);
                float vortex = sin(angle * 6.0 - radius * 3.0 + t * 2.0 + plasma * 3.0) * 0.5 + 0.5;
                vortex *= smoothstep(0.8, 0.2, length(vPosition));

                // ===== LAYER 7: Chromatic Energy Rings =====
                float rings = sin(length(vPosition) * 15.0 - t * 3.0 + coreEnergy * 5.0) * 0.5 + 0.5;
                rings = pow(rings, 3.0);

                // ===== LAYER 8: Subsurface Scattering Simulation =====
                float sss = pow(max(dot(viewDirection, -vNormal), 0.0), 2.0);
                sss += pow(1.0 - abs(dot(viewDirection, vNormal)), 4.0) * 0.5;

                // ===== COLOR COMPOSITION =====
                vec3 color = vec3(0.0);

                // Deep core - white/cyan hot center
                float coreIntensity = smoothstep(0.7, 0.0, length(vPosition)) * coreEnergy;
                vec3 coreColor = mix(uColor1, vec3(1.0), coreIntensity * 0.8);
                color += coreColor * coreIntensity * 1.5;

                // Plasma layer - primary color flowing
                vec3 plasmaColor = mix(uColor1, uColor2, plasma);
                color += plasmaColor * plasma * 0.6;

                // Energy veins - bright accent color
                vec3 veinColor = mix(uColor2, uColor3, veins);
                color += veinColor * veins * 0.8 * (1.0 + uAudioLevel);

                // Nebula clouds - subtle color variation
                vec3 nebulaColor = mix(uColor1 * 0.5, uColor3 * 0.5, nebula);
                color += nebulaColor * nebula * 0.3;

                // Fine detail highlights
                color += vec3(1.0) * detail * 0.15;

                // Vortex swirls
                vec3 vortexColor = mix(uColor2, uColor1, vortex);
                color += vortexColor * vortex * 0.25;

                // Chromatic rings
                vec3 ringColor = mix(uColor1, uColor3, rings);
                color += ringColor * rings * 0.2;

                // Subsurface glow
                vec3 sssColor = mix(uColor1, vec3(1.0), 0.3);
                color += sssColor * sss * 0.4;

                // Fresnel edge glow
                vec3 edgeColor = mix(uColor2, uColor3, fresnel);
                color += edgeColor * fresnel * 0.8;

                // Audio reactivity - pulse brightness
                float audioPulse = 1.0 + uAudioLevel * 0.5;
                color *= audioPulse;

                // Add subtle chromatic aberration at edges
                float chromatic = rim * 0.3;
                color.r += chromatic * 0.1;
                color.b += chromatic * 0.15;

                // HDR bloom simulation
                float luminance = dot(color, vec3(0.299, 0.587, 0.114));
                color += color * smoothstep(0.8, 1.5, luminance) * 0.3;

                // Alpha with depth-based transparency
                float alpha = 0.92 + fresnel * 0.08;
                alpha *= smoothstep(0.0, 0.3, coreEnergy + plasma * 0.5);

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

        const orbGeometry = new THREE.SphereGeometry(1, 128, 128); // Higher resolution
        this.orb = new THREE.Mesh(orbGeometry, this.orbMaterial);
        this.scene.add(this.orb);

        // ===== AUDIO-REACTIVE MESH BALL =====
        this.createMeshBall();

        // ===== VOLUMETRIC INNER LAYERS =====
        this.innerLayers = [];

        // Inner Core Layer - Hot white/cyan center
        const innerCoreShader = {
            vertexShader: `
                varying vec3 vPosition;
                varying vec3 vNormal;
                uniform float uTime;
                void main() {
                    vPosition = position;
                    vNormal = normalize(normalMatrix * normal);
                    float pulse = sin(uTime * 3.0) * 0.03;
                    vec3 pos = position * (1.0 + pulse);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                }
            `,
            fragmentShader: `
                varying vec3 vPosition;
                varying vec3 vNormal;
                uniform float uTime;
                uniform vec3 uColor;

                float hash(float n) { return fract(sin(n) * 43758.5453); }
                float noise(vec3 p) {
                    vec3 i = floor(p);
                    vec3 f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    float n = i.x + i.y * 57.0 + 113.0 * i.z;
                    return mix(mix(mix(hash(n), hash(n + 1.0), f.x),
                               mix(hash(n + 57.0), hash(n + 58.0), f.x), f.y),
                           mix(mix(hash(n + 113.0), hash(n + 114.0), f.x),
                               mix(hash(n + 170.0), hash(n + 171.0), f.x), f.y), f.z);
                }

                void main() {
                    float n = noise(vPosition * 5.0 + uTime);
                    float intensity = 0.8 + n * 0.4;
                    vec3 color = mix(uColor, vec3(1.0), intensity * 0.5);
                    float alpha = 0.6 * intensity;
                    gl_FragColor = vec4(color, alpha);
                }
            `
        };

        const innerCore = new THREE.Mesh(
            new THREE.SphereGeometry(0.35, 64, 64),
            new THREE.ShaderMaterial({
                ...innerCoreShader,
                uniforms: {
                    uTime: { value: 0 },
                    uColor: { value: new THREE.Color(0x00ffff) }
                },
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            })
        );
        this.scene.add(innerCore);
        this.innerLayers.push(innerCore);

        // Middle Energy Layer
        const middleLayerShader = {
            vertexShader: `
                varying vec3 vPosition;
                varying vec3 vNormal;
                uniform float uTime;
                void main() {
                    vPosition = position;
                    vNormal = normalize(normalMatrix * normal);
                    float wave = sin(position.x * 5.0 + uTime) * sin(position.y * 5.0 + uTime) * 0.02;
                    vec3 pos = position + normal * wave;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                }
            `,
            fragmentShader: `
                varying vec3 vPosition;
                varying vec3 vNormal;
                uniform float uTime;
                uniform vec3 uColor1;
                uniform vec3 uColor2;

                float fbm(vec3 p) {
                    float v = 0.0;
                    float a = 0.5;
                    for (int i = 0; i < 5; i++) {
                        v += a * (sin(p.x + p.y + p.z) * 0.5 + 0.5);
                        p = p * 2.0 + vec3(1.7, 9.2, 3.1);
                        a *= 0.5;
                    }
                    return v;
                }

                void main() {
                    vec3 p = vPosition * 3.0 + vec3(uTime * 0.2);
                    float n = fbm(p);
                    vec3 color = mix(uColor1, uColor2, n);

                    // Swirl effect
                    float angle = atan(vPosition.z, vPosition.x);
                    float swirl = sin(angle * 4.0 + length(vPosition) * 5.0 - uTime * 2.0) * 0.5 + 0.5;
                    color += uColor1 * swirl * 0.3;

                    float alpha = 0.4 * n;
                    gl_FragColor = vec4(color, alpha);
                }
            `
        };

        const middleLayer = new THREE.Mesh(
            new THREE.SphereGeometry(0.55, 64, 64),
            new THREE.ShaderMaterial({
                ...middleLayerShader,
                uniforms: {
                    uTime: { value: 0 },
                    uColor1: { value: new THREE.Color(0x8b5cf6) },
                    uColor2: { value: new THREE.Color(0x00ffff) }
                },
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            })
        );
        this.scene.add(middleLayer);
        this.innerLayers.push(middleLayer);

        // Outer Energy Shell
        const outerShellShader = {
            vertexShader: `
                varying vec3 vPosition;
                varying vec3 vNormal;
                varying vec2 vUv;
                uniform float uTime;
                void main() {
                    vPosition = position;
                    vNormal = normalize(normalMatrix * normal);
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                varying vec3 vPosition;
                varying vec3 vNormal;
                varying vec2 vUv;
                uniform float uTime;
                uniform vec3 uColor;

                void main() {
                    // Energy streams
                    float streams = sin(vUv.x * 20.0 + uTime * 3.0) * sin(vUv.y * 20.0 - uTime * 2.0);
                    streams = smoothstep(0.7, 1.0, abs(streams));

                    // Pulse rings
                    float rings = sin(length(vPosition) * 30.0 - uTime * 5.0);
                    rings = smoothstep(0.8, 1.0, abs(rings));

                    float intensity = streams * 0.5 + rings * 0.3;
                    vec3 color = uColor * intensity;

                    // Edge fade
                    vec3 viewDir = normalize(cameraPosition - vPosition);
                    float edge = pow(1.0 - abs(dot(viewDir, vNormal)), 2.0);

                    float alpha = intensity * 0.5 * (1.0 - edge * 0.5);
                    gl_FragColor = vec4(color, alpha);
                }
            `
        };

        const outerShell = new THREE.Mesh(
            new THREE.SphereGeometry(0.75, 64, 64),
            new THREE.ShaderMaterial({
                ...outerShellShader,
                uniforms: {
                    uTime: { value: 0 },
                    uColor: { value: new THREE.Color(0xec4899) }
                },
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide
            })
        );
        this.scene.add(outerShell);
        this.innerLayers.push(outerShell);

        // Outer glow atmosphere
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
                    float intensity = pow(0.65 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.5);
                    gl_FragColor = vec4(uColor, intensity * uIntensity);
                }
            `,
            uniforms: {
                uColor: { value: new THREE.Color(0x00ffff) },
                uIntensity: { value: 0.6 }
            },
            transparent: true,
            side: THREE.BackSide,
            blending: THREE.AdditiveBlending
        });

        const glowGeometry = new THREE.SphereGeometry(1.3, 32, 32);
        this.glow = new THREE.Mesh(glowGeometry, glowMaterial);
        this.scene.add(this.glow);
    }

    createMeshBall() {
        // Audio-reactive wireframe mesh ball shader
        const meshBallVertexShader = `
            varying vec3 vPosition;
            varying vec3 vNormal;
            varying float vIntensity;
            uniform float uTime;
            uniform float uAudioLevel;
            uniform float uBaseScale;

            // Noise function for organic movement
            float noise(vec3 p) {
                return fract(sin(dot(p, vec3(12.9898, 78.233, 45.543))) * 43758.5453);
            }

            void main() {
                vPosition = position;
                vNormal = normalize(normalMatrix * normal);

                // Audio-reactive scaling
                float audioScale = 1.0 + uAudioLevel * 0.6;

                // Organic breathing motion
                float breathe = sin(uTime * 2.0 + position.x * 2.0) * 0.03;
                breathe += sin(uTime * 3.0 + position.y * 2.0) * 0.02;
                breathe += sin(uTime * 1.5 + position.z * 2.0) * 0.02;

                // Add audio-driven displacement
                float audioDisplace = uAudioLevel * sin(uTime * 10.0 + length(position) * 5.0) * 0.15;

                // Vertex displacement for gas-like effect
                float displacement = noise(position * 3.0 + uTime * 0.5) * 0.1;

                vec3 newPos = position * uBaseScale * audioScale;
                newPos += normal * (breathe + audioDisplace + displacement * uAudioLevel);

                // Calculate intensity for edge glow
                vIntensity = 0.8 + uAudioLevel * 0.4;

                gl_Position = projectionMatrix * modelViewMatrix * vec4(newPos, 1.0);
            }
        `;

        const meshBallFragmentShader = `
            varying vec3 vPosition;
            varying vec3 vNormal;
            varying float vIntensity;
            uniform float uTime;
            uniform float uAudioLevel;
            uniform vec3 uColor1;
            uniform vec3 uColor2;
            uniform vec3 uColor3;

            void main() {
                // Calculate fresnel for edge glow
                vec3 viewDir = normalize(cameraPosition - vPosition);
                float fresnel = pow(1.0 - abs(dot(viewDir, vNormal)), 2.0);

                // Animated color cycling
                float colorMix = sin(uTime * 0.5 + length(vPosition) * 2.0) * 0.5 + 0.5;
                colorMix += uAudioLevel * 0.3;

                vec3 color = mix(uColor1, uColor2, colorMix);
                color = mix(color, uColor3, fresnel * 0.5);

                // Audio-reactive brightness
                float brightness = 0.7 + uAudioLevel * 0.8;
                color *= brightness;

                // Add white hot spots based on audio
                color += vec3(1.0) * uAudioLevel * fresnel * 0.5;

                // Pulsing alpha
                float alpha = (0.6 + uAudioLevel * 0.4) * vIntensity;

                gl_FragColor = vec4(color, alpha);
            }
        `;

        // Create icosahedron for interesting wireframe shape
        const meshGeometry = new THREE.IcosahedronGeometry(0.5, 2);

        // Wireframe mesh ball
        this.meshBallMaterial = new THREE.ShaderMaterial({
            vertexShader: meshBallVertexShader,
            fragmentShader: meshBallFragmentShader,
            uniforms: {
                uTime: { value: 0 },
                uAudioLevel: { value: 0 },
                uBaseScale: { value: 0.6 },
                uColor1: { value: new THREE.Color(0x00ffff) },
                uColor2: { value: new THREE.Color(0x8b5cf6) },
                uColor3: { value: new THREE.Color(0xec4899) }
            },
            transparent: true,
            wireframe: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.meshBall = new THREE.Mesh(meshGeometry, this.meshBallMaterial);
        this.scene.add(this.meshBall);

        // Second inner mesh ball (smaller, faster rotation)
        const innerMeshGeometry = new THREE.IcosahedronGeometry(0.35, 1);
        this.innerMeshBallMaterial = new THREE.ShaderMaterial({
            vertexShader: meshBallVertexShader,
            fragmentShader: meshBallFragmentShader,
            uniforms: {
                uTime: { value: 0 },
                uAudioLevel: { value: 0 },
                uBaseScale: { value: 0.5 },
                uColor1: { value: new THREE.Color(0xffffff) },
                uColor2: { value: new THREE.Color(0x00ffff) },
                uColor3: { value: new THREE.Color(0x8b5cf6) }
            },
            transparent: true,
            wireframe: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.innerMeshBall = new THREE.Mesh(innerMeshGeometry, this.innerMeshBallMaterial);
        this.scene.add(this.innerMeshBall);

        // Third tiny core mesh (hottest center)
        const coreMeshGeometry = new THREE.OctahedronGeometry(0.2, 1);
        this.coreMeshMaterial = new THREE.ShaderMaterial({
            vertexShader: meshBallVertexShader,
            fragmentShader: meshBallFragmentShader,
            uniforms: {
                uTime: { value: 0 },
                uAudioLevel: { value: 0 },
                uBaseScale: { value: 0.4 },
                uColor1: { value: new THREE.Color(0xffffff) },
                uColor2: { value: new THREE.Color(0xffffff) },
                uColor3: { value: new THREE.Color(0x00ffff) }
            },
            transparent: true,
            wireframe: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.coreMesh = new THREE.Mesh(coreMeshGeometry, this.coreMeshMaterial);
        this.scene.add(this.coreMesh);
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

        // Update inner volumetric layers
        if (this.innerLayers) {
            this.innerLayers.forEach((layer, i) => {
                if (layer.material.uniforms.uTime) {
                    layer.material.uniforms.uTime.value = time;
                }
                // Rotate each layer at different speeds for depth effect
                layer.rotation.y = time * (0.1 + i * 0.05);
                layer.rotation.x = Math.sin(time * 0.3 + i) * 0.05;
            });
        }

        // Update audio-reactive mesh balls
        if (this.meshBall) {
            this.meshBallMaterial.uniforms.uTime.value = time;
            this.meshBallMaterial.uniforms.uAudioLevel.value = this.audioLevel;
            this.meshBall.rotation.y = time * 0.3;
            this.meshBall.rotation.x = time * 0.2;
            this.meshBall.rotation.z = Math.sin(time * 0.5) * 0.1;
        }
        if (this.innerMeshBall) {
            this.innerMeshBallMaterial.uniforms.uTime.value = time;
            this.innerMeshBallMaterial.uniforms.uAudioLevel.value = this.audioLevel;
            this.innerMeshBall.rotation.y = -time * 0.5;
            this.innerMeshBall.rotation.x = time * 0.3;
        }
        if (this.coreMesh) {
            this.coreMeshMaterial.uniforms.uTime.value = time;
            this.coreMeshMaterial.uniforms.uAudioLevel.value = this.audioLevel;
            this.coreMesh.rotation.y = time * 0.8;
            this.coreMesh.rotation.z = time * 0.6;
        }

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
