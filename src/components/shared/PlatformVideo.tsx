'use client';

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {CircleAlert, Loader2} from 'lucide-react';
import {cn} from '@/lib/utils';
import HiperVersoVideoControls from '@/components/shared/HiperVersoVideoControls';
import {videoPlaybackStore, type VideoPlaybackInput} from '@/lib/media/videoPlaybackState';

type State = 'checking' | 'processing' | 'ready' | 'failed';

interface PlatformVideoProps extends React.VideoHTMLAttributes<HTMLVideoElement> {
  src: string;
  /**
   * Player autoral do HiperVerso no lugar dos controles do navegador (que nenhum CSS pinta): barra na cor da rede (`--primary`),
   * atalhos de teclado e continuidade. Só vale com `controls`; sem `themed` nada muda (mensagens, editor e a grade de mídia
   * continuam como eram).
   */
  themed?: boolean;
  /** Chave do vídeo (lib/media/videoPlaybackState.ts): com ela o vídeo retoma do segundo em que estava, em outra tela. */
  playbackKey?: string | null;
  /** Clique na SUPERFÍCIE do vídeo (fora da barra). Sem isto, o clique pausa/reproduz. No feed abre o post. */
  onSurfaceClick?: () => void;
  /**
   * Continuar TOCANDO se o vídeo foi deixado tocando há pouco em outro player (feed → página do post). Sem isto o vídeo só
   * retoma a posição, o volume e o mudo, e fica pausado.
   */
  autoplayOnResume?: boolean;
  /**
   * Quem decide se TOCA é a tela (teatro de vídeo): `true` toca, `false` pausa. Sem isto (undefined) o vídeo é só da pessoa.
   */
  active?: boolean;
  /**
   * Outro player está com o palco (o teatro aberto por cima desta página): pausa e NÃO grava a posição, para este player não
   * apagar a posição mais nova do outro.
   */
  suspended?: boolean;
}

const OWN_MEDIA = /\/(?:m|mp)\/[A-Za-z0-9_-]{22}(?:[?#]|$)/;

const FULLSCREEN_VIDEO = 'bg-black [&:fullscreen]:object-contain [&:fullscreen]:max-h-none [&:fullscreen]:w-full [&:fullscreen]:h-full [&:fullscreen]:bg-black';

/** O player autoral: o <video> sem controles nativos + a barra do HiperVerso, e a memória de onde o vídeo estava. */
function ThemedVideo({
  src,
  className,
  playbackKey,
  onSurfaceClick,
  autoplayOnResume,
  active,
  suspended,
  videoProps,
}: {
  src: string;
  className?: string;
  playbackKey?: string | null;
  onSurfaceClick?: () => void;
  autoplayOnResume?: boolean;
  active?: boolean;
  suspended?: boolean;
  videoProps: React.VideoHTMLAttributes<HTMLVideoElement>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const lastKnown = useRef<VideoPlaybackInput | null>(null);
  // O `updatedAt` da última gravação deste player: se outro player gravou depois, a saída NÃO sobrescreve (saveUnlessNewer).
  const seenAt = useRef<number | null>(null);
  const suspendedRef = useRef(false);

  const persist = useCallback(() => {
    const video = videoRef.current;
    if (!video || !playbackKey || suspendedRef.current) return;
    const state: VideoPlaybackInput = {
      currentTime: video.currentTime,
      isPlaying: !video.paused && !video.ended,
      muted: video.muted,
      volume: video.volume,
      duration: Number.isFinite(video.duration) ? video.duration : undefined,
    };
    lastKnown.current = state;
    videoPlaybackStore.save(playbackKey, state);
    seenAt.current = videoPlaybackStore.get(playbackKey)?.updatedAt ?? null;
  }, [playbackKey]);

  // Outro player no palco (teatro por cima): pausa e para de gravar. Ao voltar, quem remonta este player (a página) relê a posição.
  useEffect(() => {
    suspendedRef.current = suspended === true;
    if (suspended) videoRef.current?.pause();
  }, [suspended]);

  // O teatro manda: o vídeo ativo toca, os outros pausam (o `pause` grava a posição de quem saiu da vez).
  useEffect(() => {
    const video = videoRef.current;
    if (!video || active === undefined) return;
    if (active) void video.play().catch(() => undefined);
    else video.pause();
  }, [active]);

  // Retoma de onde estava e vai guardando o ponto. Sem chave, nada é lembrado.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playbackKey) return;
    const saved = videoPlaybackStore.get(playbackKey);
    seenAt.current = saved?.updatedAt ?? null;
    // Decidido AGORA (na montagem): é a idade do "deixei tocando" que conta, não quanto o vídeo demora a carregar.
    const keepPlaying = autoplayOnResume === true && videoPlaybackStore.handoffPlaying(playbackKey);
    let restored = false;
    const restore = () => {
      if (restored || !saved) return;
      restored = true;
      video.volume = saved.volume;
      video.muted = saved.muted;
      const at = videoPlaybackStore.resumePoint(playbackKey);
      if (at !== null) video.currentTime = at;
      // Se o navegador não deixar tocar sozinho, o vídeo fica pausado no ponto certo (um toque continua).
      if (keepPlaying) void video.play().catch(() => undefined);
    };
    if (video.readyState >= 1) restore();
    else video.addEventListener('loadedmetadata', restore, {once: true});

    let lastWrite = 0;
    const onTime = () => {
      const now = performance.now();
      if (now - lastWrite < 500) return;
      lastWrite = now;
      persist();
    };
    // Tirar o <video> da página o pausa sozinho: esse `pause` não é escolha da pessoa e não pode virar "estava pausado".
    const onPause = () => {
      if (video.isConnected) persist();
    };
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('pause', onPause);
    video.addEventListener('volumechange', persist);
    video.addEventListener('ended', persist);
    return () => {
      video.removeEventListener('loadedmetadata', restore);
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('volumechange', persist);
      video.removeEventListener('ended', persist);
      // Ao sair da tela guarda o ponto exato, mas com o "tocando" do último estado conhecido (o vídeo já foi pausado pela saída).
      // Se outro player (o teatro) gravou depois do que este viu, a posição dele é a mais nova e vale: não sobrescreve.
      if (lastKnown.current) {
        videoPlaybackStore.saveUnlessNewer(playbackKey, {...lastKnown.current, currentTime: video.currentTime}, seenAt.current);
      }
    };
  }, [playbackKey, src, persist, autoplayOnResume]);

  const onSurface = (event: React.MouseEvent<HTMLVideoElement>) => {
    event.stopPropagation();
    videoProps.onClick?.(event);
    if (onSurfaceClick) {
      persist();
      onSurfaceClick();
      return;
    }
    const video = event.currentTarget;
    if (video.paused || video.ended) void video.play().catch(() => undefined);
    else video.pause();
  };

  const effectiveSrc = !videoProps.poster && src && !src.includes('#') ? `${src}#t=0.1` : src;

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      data-interactive="true"
      className="group/video relative h-full w-full overflow-hidden bg-black outline-none focus-visible:ring-2 focus-visible:ring-primary [&:fullscreen]:flex [&:fullscreen]:items-center [&:fullscreen]:justify-center"
    >
      <video
        {...videoProps}
        ref={videoRef}
        src={effectiveSrc}
        controls={false}
        onClick={onSurface}
        className={cn(
          'cursor-pointer bg-black [:fullscreen>&]:h-full [:fullscreen>&]:max-h-none [:fullscreen>&]:w-full [:fullscreen>&]:object-contain',
          className,
        )}
      />
      <HiperVersoVideoControls videoRef={videoRef} containerRef={wrapRef} />
    </div>
  );
}

/** Player que entende o estado assíncrono da nossa mídia; URLs externas continuam sendo vídeos comuns. */
export default function PlatformVideo({src, className, themed, playbackKey, onSurfaceClick, autoplayOnResume, active, suspended, ...props}: PlatformVideoProps) {
  const ownMedia = OWN_MEDIA.test(src);
  const [state, setState] = useState<State>(ownMedia ? 'checking' : 'ready');
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!ownMedia) {
      setState('ready');
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      try {
        const response = await fetch(src, {
          method: 'HEAD',
          // `same-origin`: /mp (privado) é do nosso domínio e precisa do cookie; /m (público) vem de outro domínio com
          // `Access-Control-Allow-Origin: *`, que o navegador PROÍBE combinar com credenciais.
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (cancelled) return;
        if (response.ok) {
          setState('ready');
          return;
        }
        if (response.status === 425 || response.status === 404) {
          setState('processing');
          setProgress(Number(response.headers.get('x-media-progress') || 0));
          timer = setTimeout(check, Number(response.headers.get('retry-after') || 8) * 1000);
          return;
        }
        if (response.status === 422 || response.status === 410) {
          setState('failed');
          return;
        }
        timer = setTimeout(check, 10_000);
      } catch {
        if (!cancelled) timer = setTimeout(check, 10_000);
      }
    };
    void check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [ownMedia, src]);

  if (state === 'ready') {
    if (themed && props.controls) {
      return (
        <ThemedVideo
          src={src}
          className={className}
          playbackKey={playbackKey}
          onSurfaceClick={onSurfaceClick}
          autoplayOnResume={autoplayOnResume}
          active={active}
          suspended={suspended}
          videoProps={props}
        />
      );
    }
    return <video src={src} className={cn(FULLSCREEN_VIDEO, className)} {...props} />;
  }
  if (state === 'failed') {
    return (
      <div className={cn('flex min-h-36 flex-col items-center justify-center gap-2 bg-muted p-6 text-center', className)}>
        <CircleAlert className="h-7 w-7 text-destructive" />
        <p className="text-sm font-medium">Não foi possível processar este vídeo.</p>
        <p className="text-xs text-muted-foreground">O autor pode reenviá-lo sem perder a publicação.</p>
      </div>
    );
  }
  return (
    <div className={cn('flex min-h-36 flex-col items-center justify-center gap-3 bg-muted p-6 text-center', className)}>
      <Loader2 className="h-7 w-7 animate-spin text-primary" />
      <div>
        <p className="text-sm font-medium">Compactando vídeo em 1080p</p>
        <p className="text-xs text-muted-foreground">
          {progress > 0 ? `${progress}% concluído` : 'Pode continuar usando a plataforma. Ele aparecerá sozinho quando ficar pronto.'}
        </p>
      </div>
    </div>
  );
}
