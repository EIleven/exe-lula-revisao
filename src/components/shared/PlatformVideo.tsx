'use client';

import React, {useEffect, useState} from 'react';
import {CircleAlert, Loader2} from 'lucide-react';
import {cn} from '@/lib/utils';

type State = 'checking' | 'processing' | 'ready' | 'failed';

interface PlatformVideoProps extends React.VideoHTMLAttributes<HTMLVideoElement> {
  src: string;
}

const OWN_MEDIA = /\/(?:m|mp)\/[A-Za-z0-9_-]{22}(?:[?#]|$)/;

/** Player que entende o estado assíncrono da nossa mídia; URLs externas continuam sendo vídeos comuns. */
export default function PlatformVideo({src, className, ...props}: PlatformVideoProps) {
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
    return <video src={src} className={className} {...props} />;
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
