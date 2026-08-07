"use client";

import { useEffect, useRef } from "react";

// Particle types create visual depth:
// sparks = small, fast, bright | embers = medium, moderate | ash = large, slow, dim
type ParticleKind = "spark" | "ember" | "ash";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  baseOpacity: number;
  color: string;
  life: number;
  maxLife: number;
  kind: ParticleKind;
  flickerPhase: number;
  flickerSpeed: number;
}

const SPARK_COLORS = ["#FF5500", "#FF7722", "#FF9944"];
const EMBER_COLORS = ["#FF5500", "#F23B4E", "#FF6611"];
const ASH_COLORS = ["#FF550066", "#F23B4E44", "#88664433"];

function hexToRgba(hex: string, alpha: number): string {
  // Strip existing alpha if present
  const clean = hex.length > 7 ? hex.slice(0, 7) : hex;
  const r = parseInt(clean.slice(1, 3), 16);
  const g = parseInt(clean.slice(3, 5), 16);
  const b = parseInt(clean.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function createParticle(canvasW: number, canvasH: number): Particle {
  // 50% sparks, 35% embers, 15% ash — weighted for visual density
  const roll = Math.random();
  const kind: ParticleKind = roll < 0.5 ? "spark" : roll < 0.85 ? "ember" : "ash";

  const configs = {
    spark: {
      size: 0.5 + Math.random() * 1.5,
      vy: -(1.5 + Math.random() * 2.5),
      vx: (Math.random() - 0.5) * 0.8,
      opacity: 0.5 + Math.random() * 0.5,
      maxLife: 60 + Math.random() * 120,
      color: pick(SPARK_COLORS),
      flickerSpeed: 0.1 + Math.random() * 0.15,
    },
    ember: {
      size: 1.5 + Math.random() * 3,
      vy: -(0.8 + Math.random() * 1.5),
      vx: (Math.random() - 0.5) * 0.4,
      opacity: 0.3 + Math.random() * 0.5,
      maxLife: 120 + Math.random() * 200,
      color: pick(EMBER_COLORS),
      flickerSpeed: 0.04 + Math.random() * 0.08,
    },
    ash: {
      size: 2 + Math.random() * 4,
      vy: -(0.2 + Math.random() * 0.6),
      vx: (Math.random() - 0.5) * 0.2,
      opacity: 0.08 + Math.random() * 0.15,
      maxLife: 200 + Math.random() * 300,
      color: pick(ASH_COLORS),
      flickerSpeed: 0.02 + Math.random() * 0.04,
    },
  };

  const cfg = configs[kind];

  // Spawn from bottom third, concentrated near bottom edge
  const spawnY = canvasH + 5 + Math.random() * 10;
  // Wider horizontal spread (0.15..0.85 range) with center concentration
  // Use gaussian-like distribution: most particles in center, but tails extend wider
  const u = Math.random();
  const v = Math.random();
  // Box-Muller transform for normal distribution, then scale to spread
  const normal = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  // Map normal distribution (-3 to 3) to 0.1..0.9 range, heavily concentrated at 0.5
  const centerBias = 0.5 + Math.max(-0.4, Math.min(0.4, normal * 0.15));
  const x = canvasW * centerBias;

  return {
    x,
    y: spawnY,
    vx: cfg.vx,
    vy: cfg.vy,
    size: cfg.size,
    baseOpacity: cfg.opacity,
    color: cfg.color,
    life: 0,
    maxLife: cfg.maxLife,
    kind,
    flickerPhase: Math.random() * Math.PI * 2,
    flickerSpeed: cfg.flickerSpeed,
  };
}

export function EmberParticles() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let animationId: number;
    const particles: Particle[] = [];
    let frameCount = 0;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      canvas!.width = window.innerWidth * dpr;
      canvas!.height = window.innerHeight * dpr;
      canvas!.style.width = `${window.innerWidth}px`;
      canvas!.style.height = `${window.innerHeight}px`;
      ctx!.scale(dpr, dpr);
    }
    resize();
    window.addEventListener("resize", resize);

    const w = () => window.innerWidth;
    const h = () => window.innerHeight;

    function drawHeatGlow() {
      // Bottom heat zone: wider, more pronounced radial gradient glow
      const gradient = ctx!.createRadialGradient(
        w() * 0.5, h() * 1.02, 0,
        w() * 0.5, h() * 1.02, h() * 0.65
      );
      gradient.addColorStop(0, "rgba(255,85,0,0.10)");
      gradient.addColorStop(0.25, "rgba(255,85,0,0.06)");
      gradient.addColorStop(0.5, "rgba(242,59,78,0.03)");
      gradient.addColorStop(0.75, "rgba(255,60,0,0.01)");
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      ctx!.fillStyle = gradient;
      ctx!.fillRect(0, h() * 0.4, w(), h() * 0.6);
    }

    function animate() {
      const dpr = window.devicePixelRatio || 1;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, w(), h());

      // Draw heat glow underneath particles
      drawHeatGlow();

      frameCount++;

      // Spawn particles — ramp up quickly, then maintain
      const targetCount = 280;
      const spawnRate = particles.length < targetCount * 0.5 ? 6 : 3;
      for (let s = 0; s < spawnRate; s++) {
        if (particles.length < targetCount) {
          particles.push(createParticle(w(), h()));
        }
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];

        // Physics: gentle deceleration, slight wind oscillation
        p.x += p.vx + Math.sin(frameCount * 0.01 + p.flickerPhase) * 0.15;
        p.y += p.vy;
        p.vy *= 0.999; // Slight deceleration
        p.life++;

        const lifeRatio = p.life / p.maxLife;

        // Fade: quick fade-in, long plateau, fade-out at end
        let fadeAlpha: number;
        if (lifeRatio < 0.05) {
          fadeAlpha = lifeRatio / 0.05; // Quick fade-in
        } else if (lifeRatio > 0.7) {
          fadeAlpha = 1 - (lifeRatio - 0.7) / 0.3; // Fade-out
        } else {
          fadeAlpha = 1;
        }

        // Flicker: subtle random brightness modulation
        const flicker = 0.7 + 0.3 * Math.sin(p.life * p.flickerSpeed + p.flickerPhase);

        const alpha = p.baseOpacity * fadeAlpha * flicker;

        if (alpha <= 0.005 || p.y < -20) {
          particles.splice(i, 1);
          continue;
        }

        // Core particle
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx!.fillStyle = hexToRgba(p.color, alpha);
        ctx!.fill();

        // Glow halo — only for sparks and embers, not ash
        if (p.kind !== "ash" && alpha > 0.1) {
          const glowRadius = p.kind === "spark" ? p.size * 5 : p.size * 8;
          const glowAlpha = alpha * (p.kind === "spark" ? 0.3 : 0.2);
          const gradient = ctx!.createRadialGradient(
            p.x, p.y, 0, p.x, p.y, glowRadius
          );
          gradient.addColorStop(0, hexToRgba(p.color, glowAlpha));
          gradient.addColorStop(1, hexToRgba(p.color, 0));
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, glowRadius, 0, Math.PI * 2);
          ctx!.fillStyle = gradient;
          ctx!.fill();
        }
      }

      animationId = requestAnimationFrame(animate);
    }

    animate();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 z-0"
      style={{ pointerEvents: "none" }}
    />
  );
}
