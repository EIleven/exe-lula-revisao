'use client';

import { cn } from '@/lib/utils';
import { youtubeEmbedUrl } from '@/lib/utils/youtubeLinks';

interface YoutubeEmbedProps {
  videoId: string;
  className?: string;
  title?: string;
}

/**
 * O único modelo de vídeo do YouTube usado em posts, comentários, respostas e mensagens.
 * Centralizar o player impede que cada compositor crie uma segunda prévia genérica do mesmo link.
 */
export default function YoutubeEmbed({ videoId, className, title = 'Vídeo do YouTube' }: YoutubeEmbedProps) {
  return (
    <div
      className={cn('aspect-video w-full overflow-hidden rounded-lg border border-border bg-black', className)}
      data-interactive="true"
      data-testid="youtube-embed"
    >
      <iframe
        width="100%"
        height="100%"
        src={youtubeEmbedUrl(videoId)}
        title={title}
        frameBorder="0"
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
    </div>
  );
}
