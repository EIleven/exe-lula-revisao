// src/components/shared/ImageViewer.tsx
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogOverlay,
  DialogClose,
  DialogContent,
  DialogPortal,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, Share2, ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { haptics } from '@/lib/haptics';
import {
  IDENTITY,
  dismissOpacity,
  distanceBetween,
  doubleTap,
  midpoint,
  pan,
  pinch,
  settle,
  shouldDismiss,
  clampScale,
  clampState,
  type Point,
  type ZoomState,
} from '@/lib/gestures/zoomPan';

interface ImageViewerProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string | null;
  images?: string[];
  postUrl?: string; // URL of the post containing the image for sharing
}

const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 30; // px entre os dois toques
const TAP_SLOP = 10; // px: abaixo disto o dedo "não se moveu" (é um toque)

/**
 * Visualizador de imagem em tela cheia com os gestos de um app nativo: pinça para ampliar (acompanhando os dedos), arrastar
 * com um dedo quando ampliada, toque duplo para ampliar/voltar, puxar para baixo (ou para cima) para fechar e, no
 * computador, roda do mouse e teclas + − 0. Todos os dedos são tratados por Pointer Events (toque, caneta e mouse iguais).
 */
export default function ImageViewer({
  isOpen,
  onOpenChange,
  imageUrl,
  images,
  postUrl,
}: ImageViewerProps) {
  const { toast } = useToast();
  const t = useTranslations('ImageViewer');
  const gallery = React.useMemo(() => {
    const list = (images && images.length > 0 ? images : imageUrl ? [imageUrl] : []).filter(Boolean);
    return Array.from(new Set(list));
  }, [images, imageUrl]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const activeImageUrl = gallery[currentIndex] ?? imageUrl;
  const hasCarousel = gallery.length > 1;
  const [zoom, setZoom] = useState<ZoomState>(IDENTITY);
  const [dragY, setDragY] = useState(0); // puxar para fechar (só no tamanho original)
  const [animating, setAnimating] = useState(false); // transição suave ao soltar (nunca enquanto o dedo está na tela)
  const frameRef = useRef<HTMLDivElement>(null);

  // Dedos na tela e o que valia quando a pinça/arrasto começou.
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{
    startZoom: ZoomState;
    startMid: Point;
    startDistance: number;
    startPoint: Point;
    startTime: number;
    moved: boolean;
    lastY: number;
    lastTime: number;
    velocityY: number;
  } | null>(null);
  const lastTap = useRef<{ at: number; point: Point } | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const sizeOf = useCallback(() => {
    const rect = frameRef.current?.getBoundingClientRect();
    return { width: rect?.width ?? 1, height: rect?.height ?? 1 };
  }, []);
  /** Ponto da tela relativo ao CENTRO do quadro (a convenção de zoomPan.ts). */
  const toCenter = useCallback((clientX: number, clientY: number): Point => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return { x: clientX, y: clientY };
    return { x: clientX - (rect.left + rect.width / 2), y: clientY - (rect.top + rect.height / 2) };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const idx = imageUrl ? gallery.indexOf(imageUrl) : 0;
    setCurrentIndex(idx >= 0 ? idx : 0);
  }, [isOpen, imageUrl, gallery]);

  const goPrev = useCallback(() => {
    if (!hasCarousel) return;
    setCurrentIndex((i) => (i - 1 + gallery.length) % gallery.length);
  }, [hasCarousel, gallery.length]);

  const goNext = useCallback(() => {
    if (!hasCarousel) return;
    setCurrentIndex((i) => (i + 1) % gallery.length);
  }, [hasCarousel, gallery.length]);

  // Cada imagem começa no tamanho original.
  useEffect(() => {
    setZoom(IDENTITY);
    setDragY(0);
    pointers.current.clear();
    gesture.current = null;
    lastTap.current = null;
  }, [activeImageUrl, isOpen]);

  const beginGesture = useCallback(() => {
    const points = [...pointers.current.values()];
    const first = points[0];
    gesture.current = {
      startZoom: zoomRef.current,
      startMid: points.length > 1 ? midpoint(points[0], points[1]) : first,
      startDistance: points.length > 1 ? distanceBetween(points[0], points[1]) : 0,
      startPoint: first,
      startTime: performance.now(),
      moved: false,
      lastY: first.y,
      lastTime: performance.now(),
      velocityY: 0,
    };
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, toCenter(event.clientX, event.clientY));
    setAnimating(false);
    beginGesture(); // um dedo novo recomeça a conta (de um para dois dedos, e de volta)
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    const point = toCenter(event.clientX, event.clientY);
    pointers.current.set(event.pointerId, point);
    const g = gesture.current;
    const size = sizeOf();
    const points = [...pointers.current.values()];

    if (points.length >= 2) {
      g.moved = true;
      setDragY(0);
      setZoom(pinch(g.startZoom, g.startMid, g.startDistance, midpoint(points[0], points[1]), distanceBetween(points[0], points[1]), size));
      return;
    }

    const dx = point.x - g.startPoint.x;
    const dy = point.y - g.startPoint.y;
    if (!g.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
    g.moved = true;
    if (g.startZoom.scale > 1) {
      setZoom(pan(g.startZoom, dx, dy, size));
    } else {
      // Tamanho original: o arrasto vertical é o "puxar para fechar" (a imagem acompanha o dedo e o fundo clareia).
      const now = performance.now();
      const dt = Math.max(1, now - g.lastTime);
      g.velocityY = (point.y - g.lastY) / dt;
      g.lastY = point.y;
      g.lastTime = now;
      setDragY(dy);
    }
  };

  const finish = (event: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (!pointers.current.has(event.pointerId)) return;
    const point = toCenter(event.clientX, event.clientY);
    pointers.current.delete(event.pointerId);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const g = gesture.current;
    if (!g) return;
    const size = sizeOf();
    setAnimating(true);

    if (pointers.current.size > 0) {
      // Sobrou um dedo depois da pinça: ele continua arrastando a partir de onde a imagem está agora.
      setZoom((z) => clampState(z, size));
      beginGesture();
      return;
    }

    const wasPinch = g.startDistance > 0;
    if (wasPinch) {
      setZoom((z) => settle(z, size));
      setDragY(0);
      gesture.current = null;
      return;
    }

    if (cancelled) {
      setDragY(0);
      gesture.current = null;
      return;
    }

    if (!g.moved) {
      // Foi um toque: dois toques seguidos e próximos ampliam/voltam.
      const now = performance.now();
      const previous = lastTap.current;
      if (previous && now - previous.at <= DOUBLE_TAP_MS && distanceBetween(previous.point, point) <= DOUBLE_TAP_SLOP) {
        lastTap.current = null;
        haptics.select();
        setZoom((z) => doubleTap(z, point, size));
      } else {
        lastTap.current = { at: now, point };
      }
    } else if (g.startZoom.scale <= 1) {
      const dx = point.x - g.startPoint.x;
      const dy = point.y - g.startPoint.y;
      if (hasCarousel && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        if (dx < 0) goNext();
        else goPrev();
        setDragY(0);
        gesture.current = null;
        return;
      }
      if (shouldDismiss(dy, g.velocityY)) {
        haptics.tap();
        onOpenChange(false);
      }
      setDragY(0);
    }
    gesture.current = null;
  };

  // Computador: roda do mouse amplia no ponto sob o cursor.
  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const size = sizeOf();
    const point = toCenter(event.clientX, event.clientY);
    const factor = Math.exp(-event.deltaY * 0.0015);
    setAnimating(false);
    setZoom((z) => {
      const scale = clampScale(z.scale * factor);
      if (scale === z.scale) return z;
      const ratio = scale / z.scale;
      return settle(clampState({ scale, x: point.x - (point.x - z.x) * ratio, y: point.y - (point.y - z.y) * ratio }, size), size);
    });
  };

  // Teclado: + − ampliam, 0 volta, setas esquerda/direita navegam no carrossel (Esc fecha, pelo próprio diálogo).
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const size = sizeOf();
      if (event.key === '+' || event.key === '=') setZoom((z) => settle(clampState({ ...z, scale: clampScale(z.scale * 1.5) }, size), size));
      else if (event.key === '-' || event.key === '_') setZoom((z) => settle(clampState({ ...z, scale: clampScale(z.scale / 1.5) }, size), size));
      else if (event.key === '0') setZoom(IDENTITY);
      else if (event.key === 'ArrowLeft') goPrev();
      else if (event.key === 'ArrowRight') goNext();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, sizeOf, goPrev, goNext]);

  const handleShare = async () => {
    if (!activeImageUrl) return;

    const shareData: ShareData = {
      title: t('shareTitle'),
      text: t('shareText'),
      url: postUrl || window.location.href,
    };

    try {
      if (navigator.share && navigator.canShare(shareData)) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(shareData.url || activeImageUrl);
        toast({
          title: t('linkCopiedTitle'),
          description: t('linkCopiedBody'),
        });
      }
    } catch (error) {
      // Fechar a folha de compartilhar do sistema sem escolher nada lança AbortError: não é falha.
      if ((error as Error)?.name === 'AbortError') return;
      console.error('Error sharing image:', error);
      toast({
        title: t('shareFailedTitle'),
        description: t('shareFailedBody'),
        variant: 'destructive',
      });
    }
  };

  const handleDownload = () => {
    if (!activeImageUrl) return;
    try {
      const a = document.createElement('a');
      a.href = activeImageUrl;
      const fileName = activeImageUrl.split('/').pop()?.split('?')[0] || 'exe-lula-image.jpg';
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast({
        title: t('downloadingTitle'),
        description: t('downloadingBody', { fileName }),
      });
    } catch (error) {
      console.error('Error initiating download:', error);
      toast({
        title: t('downloadFailedTitle'),
        description: t('downloadFailedBody'),
        variant: 'destructive',
      });
      window.open(activeImageUrl, '_blank');
    }
  };

  const height = frameRef.current?.getBoundingClientRect().height ?? 800;
  const overlayOpacity = zoom.scale > 1 ? 1 : dismissOpacity(dragY, height);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="bg-black/90" style={{ opacity: overlayOpacity, transition: animating ? 'opacity 180ms ease-out' : undefined }} />
        <DialogContent
          className={cn(
            "bg-transparent p-2 sm:p-4 border-none shadow-none max-w-full w-full h-full flex flex-col items-center justify-center",
            "[&>button]:hidden"
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
          data-testid="image-viewer"
          data-scale={zoom.scale.toFixed(2)}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>

          <div className="fixed z-50 top-4 left-4">
            <DialogClose asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full bg-background/50 text-foreground hover:bg-background/70">
                    <ArrowLeft className="h-5 w-5" />
                    <span className="sr-only">{t('back')}</span>
                </Button>
            </DialogClose>
          </div>

          {hasCarousel && (
            <div className="fixed z-50 top-4 right-4 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white">
              {currentIndex + 1} / {gallery.length}
            </div>
          )}

          {activeImageUrl && (
            <div
              ref={frameRef}
              className="relative w-full h-full max-h-[calc(100vh-10rem)] overflow-hidden select-none"
              style={{ touchAction: 'none' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={(event) => finish(event, false)}
              onPointerCancel={(event) => finish(event, true)}
              onWheel={onWheel}
              data-testid="image-viewer-frame"
            >
              <img
                src={activeImageUrl}
                alt={t('imageAlt')}
                draggable={false}
                className="absolute inset-0 h-full w-full object-contain pointer-events-none"
                style={{
                  transform: `translate3d(${zoom.x}px, ${zoom.y + dragY}px, 0) scale(${zoom.scale})`,
                  transition: animating ? 'transform 180ms ease-out' : undefined,
                  willChange: 'transform',
                }}
                data-testid="image-viewer-image"
              />
            </div>
          )}

          {hasCarousel && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={goPrev}
                aria-label="Imagem anterior"
                className="fixed left-3 sm:left-5 top-1/2 -translate-y-1/2 z-50 h-11 w-11 rounded-full bg-black/60 text-white hover:bg-black/80"
              >
                <ChevronLeft className="h-6 w-6" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={goNext}
                aria-label="Próxima imagem"
                className="fixed right-3 sm:right-5 top-1/2 -translate-y-1/2 z-50 h-11 w-11 rounded-full bg-black/60 text-white hover:bg-black/80"
              >
                <ChevronRight className="h-6 w-6" />
              </Button>
            </>
          )}

          <div className="fixed bottom-0 left-0 right-0 p-3 sm:p-4 bg-gradient-to-t from-black/85 to-transparent flex flex-col items-center gap-2.5">
            {hasCarousel && (
              <div className="flex items-center gap-1.5 overflow-x-auto max-w-full px-2">
                {gallery.map((url, idx) => (
                  <button
                    key={`${url}-${idx}`}
                    type="button"
                    onClick={() => setCurrentIndex(idx)}
                    aria-label={`Ver imagem ${idx + 1}`}
                    className={cn(
                      'h-11 w-11 rounded-md overflow-hidden border-2 shrink-0 transition-all',
                      idx === currentIndex ? 'border-primary scale-105' : 'border-white/25 opacity-65 hover:opacity-100',
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
            <div className="flex justify-center items-center gap-4">
              <Button variant="secondary" onClick={handleDownload}>
                <Download className="mr-2 h-4 w-4" />
                {t('save')}
              </Button>
              <Button variant="secondary" onClick={handleShare}>
                <Share2 className="mr-2 h-4 w-4" />
                {t('share')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
