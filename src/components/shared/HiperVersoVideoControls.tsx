'use client';

// src/components/shared/HiperVersoVideoControls.tsx
// Os controles do player autoral do HiperVerso: a barra de baixo do vídeo, TODA na cor da rede (`--primary`, a que a pessoa
// escolheu em Aparência; dentro do perfil de alguém é a cor dessa pessoa). Sem azul nem cinza fixos: o navegador desenha os
// controles nativos com as cores dele e nenhum CSS os pinta, por isso existe este componente.
//
// Acessível: botões com nome, barra de progresso como `slider` (teclado e leitor de tela), atalhos (espaço/K, ←/→, J/L, ↑/↓, M,
// F, 0-9) quando o player está em foco. A lógica de contas e atalhos está em lib/media/videoControls.ts (testada).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize, Minimize, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { clamp, formatClock, fractionOf, keyAction, nextVolume, seekTarget, timeFromPointer } from '@/lib/media/videoControls';

type Props = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** O elemento que entra em tela cheia (o player inteiro, para a barra continuar visível). */
  containerRef: React.RefObject<HTMLElement | null>;
  className?: string;
};

/** Some sozinha depois de tanto tempo sem mexer, só enquanto o vídeo toca. */
const HIDE_AFTER_MS = 2_500;

export default function HiperVersoVideoControls({ videoRef, containerRef, className }: Props) {
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [visible, setVisible] = useState(true);
  const trackRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrubbing = useRef(false);

  const show = useCallback(() => {
    setVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    const video = videoRef.current;
    if (video && !video.paused && !scrubbing.current) {
      hideTimer.current = setTimeout(() => setVisible(false), HIDE_AFTER_MS);
    }
  }, [videoRef]);

  // O que o <video> informa → o que a barra mostra.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => {
      setPlaying(!video.paused && !video.ended);
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      if (!scrubbing.current) setCurrent(video.currentTime || 0);
      setVolume(video.volume);
      setMuted(video.muted || video.volume === 0);
      const b = video.buffered;
      setBuffered(b.length > 0 ? fractionOf(b.end(b.length - 1), video.duration) : 0);
    };
    const onPlayState = () => {
      sync();
      show();
    };
    const eventos = ['timeupdate', 'durationchange', 'loadedmetadata', 'volumechange', 'progress', 'seeked', 'ended'] as const;
    eventos.forEach((e) => video.addEventListener(e, sync));
    video.addEventListener('play', onPlayState);
    video.addEventListener('pause', onPlayState);
    sync();

    // Atualiza a barra de tempo a 60fps enquanto reproduz para um arraste/progresso liso.
    let rafId = 0;
    const tick = () => {
      if (!video.paused && !video.ended && !scrubbing.current) {
        setCurrent(video.currentTime || 0);
      }
      if (!video.paused && !video.ended) {
        rafId = requestAnimationFrame(tick);
      }
    };
    const startRaf = () => {
      cancelAnimationFrame(rafId);
      if (!video.paused && !video.ended) rafId = requestAnimationFrame(tick);
    };
    const stopRaf = () => cancelAnimationFrame(rafId);
    video.addEventListener('play', startRaf);
    video.addEventListener('pause', stopRaf);
    video.addEventListener('ended', stopRaf);
    startRaf();

    return () => {
      cancelAnimationFrame(rafId);
      eventos.forEach((e) => video.removeEventListener(e, sync));
      video.removeEventListener('play', onPlayState);
      video.removeEventListener('pause', onPlayState);
      video.removeEventListener('play', startRaf);
      video.removeEventListener('pause', stopRaf);
      video.removeEventListener('ended', stopRaf);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [videoRef, show]);

  const toggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused || video.ended) void video.play().catch(() => undefined);
    else video.pause();
  }, [videoRef]);

  const toggleFullscreen = useCallback(() => {
    const alvo = containerRef.current;
    if (!alvo || typeof document === 'undefined') return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    if (alvo.requestFullscreen) {
      void alvo.requestFullscreen().catch(() => undefined);
      return;
    }
    // iPhone: só o próprio <video> entra em tela cheia (e com os controles do sistema).
    (videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null)?.webkitEnterFullscreen?.();
  }, [containerRef, videoRef]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [containerRef]);

  // Mexer o mouse/dedo ou focar o player mostra a barra; atalhos só valem com o player em foco.
  useEffect(() => {
    const el = containerRef.current;
    const video = videoRef.current;
    if (!el || !video) return;
    const onKey = (e: KeyboardEvent) => {
      // Dentro do próprio controle (botão, campo de volume) a tecla é dele; o espaço no botão já aciona o botão.
      const alvo = e.target as HTMLElement | null;
      if (alvo && (alvo.tagName === 'BUTTON' || alvo.tagName === 'INPUT')) return;
      const acao = keyAction(e.key, e);
      if (!acao) return;
      e.preventDefault();
      e.stopPropagation();
      show();
      if (acao.type === 'toggle') toggle();
      else if (acao.type === 'seek') video.currentTime = seekTarget(video.currentTime, acao.delta, video.duration);
      else if (acao.type === 'seek-fraction' && Number.isFinite(video.duration)) video.currentTime = acao.fraction * video.duration;
      else if (acao.type === 'volume') {
        video.muted = false;
        video.volume = nextVolume(video.volume, acao.delta);
      } else if (acao.type === 'mute') video.muted = !video.muted;
      else if (acao.type === 'fullscreen') toggleFullscreen();
    };
    el.addEventListener('pointermove', show);
    el.addEventListener('pointerdown', show);
    el.addEventListener('focusin', show);
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointermove', show);
      el.removeEventListener('pointerdown', show);
      el.removeEventListener('focusin', show);
      el.removeEventListener('keydown', onKey);
    };
  }, [containerRef, videoRef, show, toggle, toggleFullscreen]);

  // Arrastar a barra de progresso (mouse e toque).
  const seekFromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    const track = trackRef.current;
    if (!video || !track || !Number.isFinite(video.duration)) return;
    const r = track.getBoundingClientRect();
    const alvo = timeFromPointer(e.clientX, r.left, r.width, video.duration);
    video.currentTime = alvo;
    setCurrent(alvo);
  };
  const onTrackDown = (e: React.PointerEvent<HTMLDivElement>) => {
    scrubbing.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    seekFromPointer(e);
  };
  const onTrackMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (scrubbing.current) seekFromPointer(e);
  };
  const onTrackUp = (e: React.PointerEvent<HTMLDivElement>) => {
    scrubbing.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    show();
  };
  const onTrackKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      video.currentTime = seekTarget(video.currentTime, e.key === 'ArrowLeft' ? -5 : 5, video.duration);
    }
  };

  const fracao = fractionOf(current, duration);
  const mudo = muted || volume === 0;
  const botao = 'inline-flex h-9 w-9 items-center justify-center rounded-full text-white transition-colors hover:bg-primary/25 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

  return (
    <div
      data-interactive="true"
      data-testid="exelula-video-controls"
      className={cn(
        'absolute inset-x-0 bottom-0 z-10 select-none bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 pb-2 pt-8 transition-opacity duration-200',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
        className,
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Progresso do vídeo"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, Math.round(duration))}
        aria-valuenow={Math.round(current)}
        aria-valuetext={`${formatClock(current)} de ${formatClock(duration)}`}
        className="group/trilha flex h-5 cursor-pointer touch-none items-center focus-visible:outline-none"
        onPointerDown={onTrackDown}
        onPointerMove={onTrackMove}
        onPointerUp={onTrackUp}
        onPointerCancel={onTrackUp}
        onKeyDown={onTrackKey}
      >
        <div className="relative h-1 w-full rounded-full bg-white/30 transition-all group-hover/trilha:h-1.5 group-focus-visible/trilha:h-1.5">
          <div className="absolute inset-y-0 left-0 rounded-full bg-white/40" style={{ width: `${buffered * 100}%` }} />
          <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${fracao * 100}%` }} />
          <div
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary opacity-0 ring-2 ring-primary/40 transition-opacity group-hover/trilha:opacity-100 group-focus-visible/trilha:opacity-100"
            style={{ left: `${fracao * 100}%` }}
          />
        </div>
      </div>

      <div className="mt-1 flex items-center gap-1">
        <button type="button" className={botao} onClick={toggle} aria-label={playing ? 'Pausar' : 'Reproduzir'} title={playing ? 'Pausar (K)' : 'Reproduzir (K)'}>
          {playing ? <Pause className="h-5 w-5" fill="currentColor" /> : <Play className="h-5 w-5" fill="currentColor" />}
        </button>

        <button
          type="button"
          className={botao}
          onClick={() => {
            const video = videoRef.current;
            if (video) video.muted = !video.muted;
          }}
          aria-label={mudo ? 'Ativar o som' : 'Silenciar'}
          title={mudo ? 'Ativar o som (M)' : 'Silenciar (M)'}
        >
          {mudo ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={mudo ? 0 : volume}
          onChange={(e) => {
            const video = videoRef.current;
            if (!video) return;
            video.muted = false;
            video.volume = clamp(Number(e.target.value), 0, 1);
          }}
          aria-label="Volume"
          className="hidden h-1 w-16 cursor-pointer accent-primary sm:block"
        />

        <span className="ml-1 text-xs tabular-nums text-white/90" aria-hidden="true">
          {formatClock(current)} / {formatClock(duration)}
        </span>

        <button type="button" className={cn(botao, 'ml-auto')} onClick={toggleFullscreen} aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'} title={fullscreen ? 'Sair da tela cheia (F)' : 'Tela cheia (F)'}>
          {fullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
        </button>
      </div>
    </div>
  );
}
