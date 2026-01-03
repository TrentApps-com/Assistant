/**
 * Parallax Star Background
 * Creates floating dots that respond to mouse movement
 */

class ParallaxStars {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'starsCanvas';
        this.canvas.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: -1;
            pointer-events: none;
        `;
        document.body.insertBefore(this.canvas, document.body.firstChild);

        this.ctx = this.canvas.getContext('2d');
        this.stars = [];
        this.mouse = { x: 0, y: 0 };
        this.targetMouse = { x: 0, y: 0 };

        this.resize();
        this.createStars();
        this.bindEvents();
        this.animate();
    }

    resize() {
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.canvas.width = this.width;
        this.canvas.height = this.height;
    }

    createStars() {
        this.stars = [];
        const starCount = Math.floor((this.width * this.height) / 4000);

        // Color palette matching the orb
        const colors = [
            { r: 0, g: 255, b: 255 },    // Cyan
            { r: 139, g: 92, b: 246 },   // Purple
            { r: 236, g: 72, b: 153 },   // Pink
            { r: 255, g: 255, b: 255 },  // White
            { r: 96, g: 165, b: 250 },   // Light blue
        ];

        for (let i = 0; i < starCount; i++) {
            const depth = Math.random() * 3 + 1; // 1-4 depth layers
            const color = colors[Math.floor(Math.random() * colors.length)];

            this.stars.push({
                x: Math.random() * this.width,
                y: Math.random() * this.height,
                baseX: Math.random() * this.width,
                baseY: Math.random() * this.height,
                size: (Math.random() * 2 + 0.5) / depth,
                depth: depth,
                color: color,
                alpha: (Math.random() * 0.5 + 0.3) / depth,
                twinkleSpeed: Math.random() * 2 + 1,
                twinklePhase: Math.random() * Math.PI * 2,
                driftX: (Math.random() - 0.5) * 0.2,
                driftY: (Math.random() - 0.5) * 0.1
            });
        }

        // Sort by depth for proper layering
        this.stars.sort((a, b) => b.depth - a.depth);
    }

    bindEvents() {
        window.addEventListener('resize', () => {
            this.resize();
            this.createStars();
        });

        document.addEventListener('mousemove', (e) => {
            this.targetMouse.x = (e.clientX / this.width - 0.5) * 2;
            this.targetMouse.y = (e.clientY / this.height - 0.5) * 2;
        });

        // Touch support
        document.addEventListener('touchmove', (e) => {
            if (e.touches.length > 0) {
                this.targetMouse.x = (e.touches[0].clientX / this.width - 0.5) * 2;
                this.targetMouse.y = (e.touches[0].clientY / this.height - 0.5) * 2;
            }
        });
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        // Smooth mouse following
        this.mouse.x += (this.targetMouse.x - this.mouse.x) * 0.05;
        this.mouse.y += (this.targetMouse.y - this.mouse.y) * 0.05;

        const time = Date.now() * 0.001;

        // Clear with fade for trail effect
        this.ctx.fillStyle = 'rgba(10, 10, 20, 0.3)';
        this.ctx.fillRect(0, 0, this.width, this.height);

        // Draw stars
        this.stars.forEach(star => {
            // Parallax offset based on mouse and depth
            const parallaxX = this.mouse.x * (50 / star.depth);
            const parallaxY = this.mouse.y * (30 / star.depth);

            // Slow drift animation
            const driftX = Math.sin(time * star.driftX + star.twinklePhase) * (10 / star.depth);
            const driftY = Math.cos(time * star.driftY + star.twinklePhase) * (5 / star.depth);

            // Final position
            const x = star.baseX + parallaxX + driftX;
            const y = star.baseY + parallaxY + driftY;

            // Twinkle effect
            const twinkle = Math.sin(time * star.twinkleSpeed + star.twinklePhase) * 0.3 + 0.7;
            const alpha = star.alpha * twinkle;

            // Draw glow
            const glowSize = star.size * 4;
            const gradient = this.ctx.createRadialGradient(x, y, 0, x, y, glowSize);
            gradient.addColorStop(0, `rgba(${star.color.r}, ${star.color.g}, ${star.color.b}, ${alpha})`);
            gradient.addColorStop(0.5, `rgba(${star.color.r}, ${star.color.g}, ${star.color.b}, ${alpha * 0.3})`);
            gradient.addColorStop(1, `rgba(${star.color.r}, ${star.color.g}, ${star.color.b}, 0)`);

            this.ctx.beginPath();
            this.ctx.arc(x, y, glowSize, 0, Math.PI * 2);
            this.ctx.fillStyle = gradient;
            this.ctx.fill();

            // Draw core
            this.ctx.beginPath();
            this.ctx.arc(x, y, star.size, 0, Math.PI * 2);
            this.ctx.fillStyle = `rgba(${star.color.r}, ${star.color.g}, ${star.color.b}, ${alpha * 1.5})`;
            this.ctx.fill();
        });

        // Occasional shooting stars
        if (Math.random() < 0.002) {
            this.createShootingStar();
        }

        // Draw shooting stars
        this.drawShootingStars(time);
    }

    createShootingStar() {
        if (!this.shootingStars) this.shootingStars = [];
        if (this.shootingStars.length > 3) return;

        const colors = [
            { r: 0, g: 255, b: 255 },
            { r: 236, g: 72, b: 153 },
            { r: 255, g: 255, b: 255 }
        ];

        this.shootingStars.push({
            x: Math.random() * this.width,
            y: Math.random() * this.height * 0.5,
            vx: (Math.random() * 10 + 5) * (Math.random() > 0.5 ? 1 : -1),
            vy: Math.random() * 5 + 3,
            life: 1,
            color: colors[Math.floor(Math.random() * colors.length)],
            size: Math.random() * 2 + 1
        });
    }

    drawShootingStars(time) {
        if (!this.shootingStars) return;

        this.shootingStars = this.shootingStars.filter(star => {
            star.x += star.vx;
            star.y += star.vy;
            star.life -= 0.02;

            if (star.life <= 0) return false;

            // Draw trail
            const trailLength = 30;
            for (let i = 0; i < trailLength; i++) {
                const t = i / trailLength;
                const tx = star.x - star.vx * t * 3;
                const ty = star.y - star.vy * t * 3;
                const alpha = star.life * (1 - t) * 0.5;

                this.ctx.beginPath();
                this.ctx.arc(tx, ty, star.size * (1 - t * 0.5), 0, Math.PI * 2);
                this.ctx.fillStyle = `rgba(${star.color.r}, ${star.color.g}, ${star.color.b}, ${alpha})`;
                this.ctx.fill();
            }

            return star.life > 0 && star.x > 0 && star.x < this.width && star.y < this.height;
        });
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.parallaxStars = new ParallaxStars();
});
