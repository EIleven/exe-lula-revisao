// src/components/shared/MediaGrid.tsx
'use client';

import type { KeyboardEvent, MouseEvent } from 'react';
import type { Media } from '@/lib/types';
import { cn } from '@/lib/utils';
import PlatformVideo from './PlatformVideo';

interface MediaGridProps {
  media: Media[];
  /** Texto alternativo para a mídia que não tem `alt` (por exemplo, o começo do texto da publicação). */
  fallbackAlt?: string;
  /** Toque ou clique numa imagem (abre o visualizador). Vídeo usa os controles do próprio player. */
  onImageClick?: (url: string, index: number) => void;
  /** Altura máxima de uma mídia sozinha. */
  singleMaxHeightClass?: string;
  className?: string;
}

/**
 * Grade de mídia (imagens e vídeos) de um comentário: 1 mídia ocupa a largura toda; 2 ficam lado a lado; 3 têm a
 * primeira alta à esquerda; 4 formam um quadrado 2x2. Mostra TODAS as mídias (o card do comentário só mostrava a primeira).
 * Usa `<img>` simples: as imagens já são reduzidas antes do envio (mediaUploadService), então não passam pelo otimizador
 * do Next (que exigiria cada host de Storage na lista de domínios).
 */
export default function MediaGrid({ media, fallbackAlt, onImageClick, singleMaxHeightClass = 'max-h-[40vh]', className }: MediaGridProps) {
  const items = media.filter((item) => !!item?.url);
  if (items.length === 0) return null;
  const single = items.length === 1;
  const three = items.length === 3;

  const open = (event: MouseEvent | KeyboardEvent, url: string, index: number) => {
    event.stopPropagation(); // não navega para o post ao tocar na imagem
    onImageClick?.(url, index);
  };

  return (
    <div className={cn('rounded-lg border border-border overflow-hidden', className)} data-testid="media-grid">
      <div className={cn('grid gap-0.5', single ? 'grid-cols-1' : 'grid-cols-2')}>
        {items.map((item, index) => {
          const isVideo = item.type === 'video';
          const alt = item.alt || fallbackAlt || `Mídia ${index + 1}`;
          const tileClass = cn(
            'relative overflow-hidden bg-muted [touch-action:manipulation]',
            !single && 'aspect-square',
            three && index === 0 && 'row-span-2',
            !isVideo && onImageClick && 'cursor-pointer',
          );
          if (isVideo) {
            return (
              <div key={`${item.url}-${index}`} className={tileClass} data-interactive="true">
                <PlatformVideo
                  src={item.url}
                  className={cn('w-full object-cover', single ? cn('h-auto', singleMaxHeightClass) : 'h-full')}
                  controls
                  preload="metadata"
                  playsInline
                  onClick={(event) => event.stopPropagation()}
                />
              </div>
            );
          }
          return (
            <div
              key={`${item.url}-${index}`}
              className={tileClass}
              data-interactive="true"
              role={onImageClick ? 'button' : undefined}
              tabIndex={onImageClick ? 0 : undefined}
              aria-label={onImageClick ? `Ampliar: ${alt}` : undefined}
              onClick={onImageClick ? (event) => open(event, item.url, index) : undefined}
              onKeyDown={onImageClick ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(event, item.url, index); } } : undefined}
            >
              <img
                src={item.url}
                alt={alt}
                loading="lazy"
                decoding="async"
                draggable={false}
                className={cn('w-full object-cover', single ? cn('h-auto', singleMaxHeightClass) : 'h-full')}
                data-ai-hint={item['data-ai-hint'] || 'image content'}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
