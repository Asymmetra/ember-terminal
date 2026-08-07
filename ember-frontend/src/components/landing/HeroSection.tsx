"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { EmberParticles } from "./EmberParticles";

const stagger = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.15, delayChildren: 0.3 },
  },
};

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] },
  },
};

export function HeroSection() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden">
      <EmberParticles />

      {/* Radial vignette: draws eye to center, darkens edges */}
      <div
        className="pointer-events-none absolute inset-0 z-[1]"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 50%, transparent 0%, rgba(12,12,14,0.4) 70%, rgba(12,12,14,0.85) 100%)",
        }}
      />

      <motion.div
        className="relative z-10 flex flex-col items-center gap-6"
        variants={stagger}
        initial="hidden"
        animate="visible"
      >
        {/* Brand label */}
        <motion.div variants={fadeUp} className="flex items-center gap-3">
          <motion.div
            className="h-2 w-2 bg-ember-orange"
            animate={{
              opacity: [0.4, 1, 0.4],
              boxShadow: [
                "0 0 4px rgba(255,85,0,0.3)",
                "0 0 12px rgba(255,85,0,0.6)",
                "0 0 4px rgba(255,85,0,0.3)",
              ],
            }}
            transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
          />
          <span className="font-mono text-[11px] tracking-[0.35em] text-text-secondary/70 uppercase">
            Ember Terminal
          </span>
        </motion.div>

        {/* Headline */}
        <motion.h1
          variants={fadeUp}
          className="text-center font-mono font-bold leading-[0.9] tracking-tight text-text-primary"
        >
          <span className="block text-6xl md:text-8xl lg:text-9xl">IGNITE</span>
          <span
            className="block text-6xl md:text-8xl lg:text-9xl text-ember-orange"
            style={{
              textShadow: "0 0 40px rgba(255,85,0,0.3), 0 0 80px rgba(255,85,0,0.1)",
            }}
          >
            TERMINAL
          </span>
        </motion.h1>

        {/* Tagline */}
        <motion.p
          variants={fadeUp}
          className="max-w-sm text-center text-sm leading-relaxed text-text-secondary/80"
        >
          Next-generation perpetuals trading on Solana.
          <br />
          <span className="text-text-secondary/50">Powered by Phoenix.</span>
        </motion.p>

        {/* CTA */}
        <motion.div variants={fadeUp} className="mt-4">
          <Link
            href="/terminal"
            className="group relative inline-flex items-center border border-ember-orange/60 bg-transparent px-10 py-3.5 font-mono text-xs font-medium tracking-[0.2em] text-ember-orange transition-all duration-300 hover:border-ember-orange hover:bg-ember-orange/10 hover:text-ember-orange"
            style={{
              boxShadow: "0 0 20px rgba(255,85,0,0.08)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = "0 0 30px rgba(255,85,0,0.2), inset 0 0 20px rgba(255,85,0,0.05)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = "0 0 20px rgba(255,85,0,0.08)";
            }}
          >
            LAUNCH TERMINAL
            <svg
              className="ml-3 h-3 w-3 transition-transform duration-300 group-hover:translate-x-0.5"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M2.5 6h7M6.5 2.5L10 6l-3.5 3.5" />
            </svg>
          </Link>
        </motion.div>

        {/* Subtle version tag */}
        <motion.span
          variants={fadeUp}
          className="mt-8 font-mono text-[10px] tracking-widest text-text-secondary/30 uppercase"
        >
          v0.1 &middot; mainnet
        </motion.span>
      </motion.div>
    </div>
  );
}
