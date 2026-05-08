import { useEffect, useRef } from 'react';
import { useGameStore, formatMultiplier } from '../../stores/game.store';

const GROWTH_RATE = 0.00006; // mesma fórmula do backend

function calcMultiplier(elapsedMs: number): number {
  return Math.floor(Math.pow(Math.E, GROWTH_RATE * elapsedMs) * 100) / 100;
}

/**
 * CrashGraph
 *
 * Canvas 2D que desenha a curva exponencial do multiplicador em tempo real.
 * - Eixo X = tempo (ms)
 * - Eixo Y = multiplicador
 * A curva é redesenhada a cada frame via requestAnimationFrame.
 * Em CRASHED, exibe shake animation e o crash point em vermelho.
 */
export function CrashGraph() {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const startRef    = useRef<number | null>(null);
  const rafRef      = useRef<number>(0);
  const { status, multiplier, serverSeedHash } = useGameStore();

  useEffect(() => {
    if (status === 'RUNNING') startRef.current = Date.now();
    if (status !== 'RUNNING') cancelAnimationFrame(rafRef.current);
  }, [status]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    function draw() {
      const W = canvas!.width  = canvas!.offsetWidth;
      const H = canvas!.height = canvas!.offsetHeight;
      ctx.clearRect(0, 0, W, H);

      // Fundo com gradiente sutil
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, 'rgba(0,255,136,0.04)');
      bg.addColorStop(1, 'transparent');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const now     = startRef.current ? Date.now() - startRef.current : 0;
      const maxTime = Math.max(now, 1);
      const maxMult = status === 'RUNNING'
        ? Math.max(calcMultiplier(maxTime), 1.5)
        : Math.max(multiplier + 0.5, 1.5);

      const PAD = { top: 40, right: 30, bottom: 50, left: 60 };
      const gW  = W - PAD.left - PAD.right;
      const gH  = H - PAD.top  - PAD.bottom;

      const toX = (t: number) => PAD.left + (t / maxTime) * gW;
      const toY = (m: number) => PAD.top  + gH - ((m - 1) / (maxMult - 1)) * gH;

      // Grid
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth   = 1;
      for (let i = 1; i <= 4; i++) {
        const y = PAD.top + (gH / 4) * i;
        ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W - PAD.right, y);
        ctx.stroke();
      }

      // Y axis labels
      ctx.fillStyle   = 'rgba(136,136,170,0.7)';
      ctx.font        = '11px Space Mono';
      ctx.textAlign   = 'right';
      for (let i = 0; i <= 4; i++) {
        const m   = 1 + ((maxMult - 1) / 4) * (4 - i);
        const y   = PAD.top + (gH / 4) * i;
        ctx.fillText(`${m.toFixed(2)}x`, PAD.left - 6, y + 4);
      }

      // Draw curve
      if (status === 'IDLE' || status === 'BETTING') {
        // Linha base flat em 1.00x
        ctx.beginPath();
        ctx.moveTo(PAD.left, toY(1));
        ctx.lineTo(W - PAD.right, toY(1));
        ctx.strokeStyle = 'rgba(136,136,170,0.3)';
        ctx.lineWidth   = 2;
        ctx.stroke();
        return;
      }

      // Pontos da curva
      const steps = 120;
      const pts: [number, number][] = [];
      for (let i = 0; i <= steps; i++) {
        const t = (maxTime / steps) * i;
        const m = calcMultiplier(t);
        pts.push([toX(t), toY(Math.min(m, maxMult))]);
      }

      // Área preenchida
      const grad = ctx.createLinearGradient(0, PAD.top, 0, H);
      const color = status === 'CRASHED' ? '255,51,102' : '0,255,136';
      grad.addColorStop(0,   `rgba(${color},0.25)`);
      grad.addColorStop(0.6, `rgba(${color},0.08)`);
      grad.addColorStop(1,   `rgba(${color},0)`);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], toY(1));
      for (const [x, y] of pts) ctx.lineTo(x, y);
      ctx.lineTo(pts[pts.length - 1][0], toY(1));
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Linha principal
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const [x, y] of pts) ctx.lineTo(x, y);
      ctx.strokeStyle = status === 'CRASHED'
        ? '#ff3366' : '#00ff88';
      ctx.lineWidth   = 2.5;
      ctx.shadowColor = status === 'CRASHED' ? '#ff3366' : '#00ff88';
      ctx.shadowBlur  = 12;
      ctx.stroke();
      ctx.shadowBlur  = 0;

      // Ponto atual (bolinha)
      if (pts.length > 0) {
        const [lx, ly] = pts[pts.length - 1];
        ctx.beginPath();
        ctx.arc(lx, ly, 5, 0, Math.PI * 2);
        ctx.fillStyle = status === 'CRASHED' ? '#ff3366' : '#00ff88';
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur  = 20;
        ctx.fill();
        ctx.shadowBlur  = 0;
      }

      if (status === 'RUNNING') rafRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [status, multiplier]);

  const isCrashed = status === 'CRASHED';
  const isBetting = status === 'BETTING' || status === 'IDLE';

  return (
    <div className={`game-canvas w-full h-full flex flex-col ${isCrashed ? 'animate-crash-shake' : ''}`}
         style={{ minHeight: 300 }}>
      {/* Seed hash - canto superior esquerdo */}
      {serverSeedHash && (
        <div className="absolute top-3 left-4 z-10">
          <div style={{ color: 'var(--text-dim)', fontSize: '0.6rem', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em' }}>
            SEED HASH
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.62rem', fontFamily: 'var(--font-mono)' }}
               title={serverSeedHash}>
            {serverSeedHash.slice(0, 20)}...
          </div>
        </div>
      )}

      {/* Multiplicador central */}
      <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
        <div className="text-center">
          <div
            className={`multiplier-value ${
              isCrashed ? 'multiplier-crashed' :
              isBetting ? 'multiplier-betting' :
              'multiplier-running'
            }`}
            style={{ fontSize: 'clamp(4rem, 10vw, 7rem)' }}
          >
            {formatMultiplier(multiplier)}
          </div>
          {isCrashed && (
            <div className="animate-fade-in-up" style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 900,
              fontSize: '1.2rem',
              letterSpacing: '0.2em',
              color: 'var(--neon-red)',
              marginTop: 4,
            }}>
              CRASHED
            </div>
          )}
          {isBetting && (
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: '0.9rem',
              letterSpacing: '0.2em',
              color: 'var(--text-dim)',
              marginTop: 4,
            }}>
              APOSTAS ABERTAS
            </div>
          )}
        </div>
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  );
}
