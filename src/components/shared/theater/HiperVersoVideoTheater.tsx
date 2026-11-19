// src/components/shared/theater/HiperVersoVideoTheater.tsx
// O MODO IMERSIVO do HiperVerso: os vídeos da lista que a pessoa estava vendo (feed ou aba Mídia do perfil) em tela cheia, um por vez,
// rolando na vertical (rolagem, deslizar o dedo, ↑/↓, PageUp/PageDown). Vídeo limpo (`object-contain`), ícones flutuantes discretos
// (Curtir, Comentários, Repostar, Salvar, velocidade), autor + Seguir embaixo e gaveta de comentários.
//
// O botão VOLTAR (canto superior esquerdo) está sempre na tela; Esc e o "voltar" do navegador/Android também fecham: o teatro empurra
// uma entrada no histórico ao abrir, então voltar fecha o teatro (e não a página de baixo). A posição de cada vídeo é guardada em
// lib/media/videoPlaybackState.ts, e quem abriu o teatro relê isso ao fechar (o vídeo continua do mesmo segundo).
//
// Só o vídeo ativo e os vizinhos têm <video> montado (lib/media/videoQueue.ts#windowIndexes): uma fila de 200 não pesa na memória.
'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { ArrowLeft, ArrowUp } from 'lucide-react';
import { auth } from '@/lib/firebase';
import PlatformVideo from '@/components/shared/PlatformVideo';
import type { Post } from '@/lib/types';
import { playbackKey, videoPlaybackStore } from '@/lib/media/videoPlaybackState';
import { buildMixedMediaQueue, stepIndex, windowIndexes, type QueueEntry } from '@/lib/media/videoQueue';
import { TheaterActionRail, TheaterAuthorInfo } from './TheaterActionRail';
import TheaterCommentsSheet from './TheaterCommentsSheet';
import { haptics } from '@/lib/haptics';

type Props = {
  entries: QueueEntry<Post>[];
  startIndex: number;
  onClose: () => void;
};

export default function HiperVersoVideoTheater({ entries, startIndex, onClose }: Props) {
  const locale = useLocale();
  const [items, setItems] = useState<QueueEntry<Post>[]>(entries);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [pendingTopItems, setPendingTopItems] = useState<QueueEntry<Post>[]>([]);
  const loadingMoreRef = useRef(false);
  const watchedKeysRef = useRef<Set<string>>(new Set());
  const watchedUrlsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setItems(entries);
  }, [entries]);

  const total = items.length;
  const inicio = stepIndex(startIndex, 0, total);
  const [active, setActive] = useState(inicio);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [login, setLogin] = useState<string | null>(null);
  // Comentários publicados na gaveta, por vídeo: o contador do ícone sobe sem recarregar nada.
  const [extraComments, setExtraComments] = useState<Record<string, number>>({});

  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const didMountHapticRef = useRef(false);
  useEffect(() => {
    if (!didMountHapticRef.current) {
      didMountHapticRef.current = true;
      return;
    }
    haptics.select();
  }, [active]);
  const commentsOpenRef = useRef(commentsOpen);
  commentsOpenRef.current = commentsOpen;
  const loginRef = useRef(login);
  loginRef.current = login;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // O som que a pessoa escolheu vale para os próximos vídeos da fila (quem silenciou um não quer áudio no seguinte).
  const soundRef = useRef<{ muted: boolean; volume: number } | null>(null);

  const janela = useMemo(() => windowIndexes(active, total, 1), [active, total]);
  const entryAtiva = items[active];

  const unmountedRef = useRef(false);
  const cursorRef = useRef(cursor);
  const itemsRef = useRef(items);
  const hasMoreRef = useRef(hasMore);
  cursorRef.current = cursor;
  itemsRef.current = items;
  hasMoreRef.current = hasMore;

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  // Marca a mídia atual como já vista (chave e URL) para não repetir ao atualizar o topo do feed.
  useEffect(() => {
    if (entryAtiva?.key) {
      watchedKeysRef.current.add(entryAtiva.key);
    }
    if (entryAtiva?.url) {
      watchedUrlsRef.current.add(entryAtiva.url);
    }
  }, [entryAtiva?.key, entryAtiva?.url]);

  // Verifica periodicamente (e ao voltar para a aba) se chegou mídia nova no topo da timeline.
  useEffect(() => {
    const checkTopMedia = async () => {
      if (unmountedRef.current || document.visibilityState === 'hidden') return;
      try {
        const token = await auth.currentUser?.getIdToken().catch(() => null);
        const params = new URLSearchParams({ locale });
        const res = await fetch(`/api/media/theater-feed?${params.toString()}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok || unmountedRef.current) return;
        const data = (await res.json()) as { posts?: Post[] };
        if (unmountedRef.current) return;
        const topEntries = buildMixedMediaQueue(data.posts ?? []);
        const currentKeys = new Set(itemsRef.current.map((p) => p.key));
        const currentUrls = new Set(itemsRef.current.map((p) => p.url));
        const freshTop = topEntries.filter(
          (entry) =>
            !currentKeys.has(entry.key) &&
            !currentUrls.has(entry.url) &&
            !watchedKeysRef.current.has(entry.key) &&
            !watchedUrlsRef.current.has(entry.url),
        );
        if (freshTop.length > 0) {
          setPendingTopItems((prev) => {
            const seenPending = new Set(prev.map((p) => p.key));
            const seenPendingUrls = new Set(prev.map((p) => p.url));
            const added = freshTop.filter(
              (n) => !seenPending.has(n.key) && !seenPendingUrls.has(n.url),
            );
            return added.length > 0 ? [...added, ...prev] : prev;
          });
        }
      } catch {
        // Silencioso: não interrompe a reprodução atual.
      }
    };

    const intervalId = window.setInterval(checkTopMedia, 35_000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void checkTopMedia();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [locale]);

  const aplicarNovasMidiasNoTopo = useCallback(() => {
    if (pendingTopItems.length === 0) return;
    haptics.select();
    const novas = pendingTopItems.filter(
      (n) => !watchedKeysRef.current.has(n.key) && !watchedUrlsRef.current.has(n.url),
    );
    setItems((prev) => {
      const seenKeys = new Set(novas.map((n) => n.key));
      const seenUrls = new Set(novas.map((n) => n.url));
      const restantes: QueueEntry<Post>[] = [];
      for (const p of prev) {
        if (
          watchedKeysRef.current.has(p.key) ||
          watchedUrlsRef.current.has(p.url) ||
          seenKeys.has(p.key) ||
          seenUrls.has(p.url)
        ) {
          continue;
        }
        seenKeys.add(p.key);
        seenUrls.add(p.url);
        restantes.push(p);
      }
      return [...novas, ...restantes];
    });
    setPendingTopItems([]);
    setActive(0);
    requestAnimationFrame(() => {
      scrollerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }, [pendingTopItems]);

  // Rolagem contínua: ao chegar perto do fim da fila carregada, busca mais vídeos/imagens em ordem cronológica estrita.
  useEffect(() => {
    if (!hasMore || loadingMoreRef.current || total === 0 || active < Math.max(0, total - 4)) return;
    loadingMoreRef.current = true;
    const reqCursor = cursorRef.current;
    (async () => {
      try {
        const token = await auth.currentUser?.getIdToken().catch(() => null);
        const exclude = itemsRef.current.slice(-60).map((e) => e.postId).join(',');
        const params = new URLSearchParams({ locale, exclude });
        if (reqCursor) params.set('cursor', reqCursor);
        const res = await fetch(`/api/media/theater-feed?${params.toString()}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok || unmountedRef.current) return;
        const data = (await res.json()) as { posts?: Post[]; nextCursor?: string | null };
        if (unmountedRef.current) return;
        const nextEntries = buildMixedMediaQueue(data.posts ?? []);
        if (nextEntries.length > 0) {
          setItems((prev) => {
            const seen = new Set(prev.map((p) => p.key));
            const fresh = nextEntries.filter((n) => !seen.has(n.key));
            return fresh.length > 0 ? [...prev, ...fresh] : prev;
          });
        }
        const nextCursor = data.nextCursor ?? null;
        if (!nextCursor || nextCursor === reqCursor) {
          setCursor(null);
          if (nextEntries.length === 0) setHasMore(false);
        } else {
          setCursor(nextCursor);
        }
      } catch {
        // Silencioso: mantém a fila atual sem interromper quem assiste.
      } finally {
        loadingMoreRef.current = false;
      }
    })();
  }, [active, cursor, hasMore, locale, total]);

  // Abre já no vídeo certo, antes da primeira pintura (sem piscar o primeiro da fila).
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = inicio * el.clientHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A página de baixo não rola enquanto o teatro está aberto.
  useEffect(() => {
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = anterior;
    };
  }, []);

  // "Voltar" do navegador e do Android fecham o TEATRO: ele ocupa uma entrada do histórico enquanto está aberto.
  useEffect(() => {
    const estado = { ...(window.history.state ?? {}), exelulaTheater: true };
    window.history.pushState(estado, '', window.location.href);
    let fechadoPeloNavegador = false;
    const aoVoltar = () => {
      fechadoPeloNavegador = true;
      onCloseRef.current();
    };
    window.addEventListener('popstate', aoVoltar);
    return () => {
      window.removeEventListener('popstate', aoVoltar);
      // Fechou pelo botão ou pelo Esc: desfaz a entrada que criamos (sem mexer se a pessoa já navegou para outra página).
      if (!fechadoPeloNavegador && window.history.state?.exelulaTheater) window.history.back();
    };
  }, []);

  // Quem está no centro da tela é o ativo (>= 60% visível).
  useEffect(() => {
    const raiz = scrollerRef.current;
    if (!raiz || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (registros) => {
        for (const r of registros) {
          if (!r.isIntersecting || r.intersectionRatio < 0.6) continue;
          const i = Number((r.target as HTMLElement).dataset.index);
          if (Number.isFinite(i)) setActive(i);
        }
      },
      { root: raiz, threshold: [0.6] },
    );
    raiz.querySelectorAll<HTMLElement>('[data-index]').forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [total]);

  const irPara = useCallback((i: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    const reduzir = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ top: i * el.clientHeight, behavior: reduzir ? 'auto' : 'smooth' });
  }, []);

  // Teclado: ↑/↓ e PageUp/PageDown andam na fila; Esc fecha (ou fecha a gaveta). Em fase de captura, para ganhar do volume do player.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      const digitando = !!alvo && (alvo.tagName === 'TEXTAREA' || alvo.tagName === 'INPUT' || alvo.isContentEditable);
      if (e.key === 'Escape') {
        if (document.fullscreenElement) return; // o navegador sai da tela cheia primeiro
        e.preventDefault();
        e.stopPropagation();
        if (loginRef.current) setLogin(null);
        else if (commentsOpenRef.current) setCommentsOpen(false);
        else onCloseRef.current();
        return;
      }
      if (digitando || commentsOpenRef.current || loginRef.current) return;
      const passo = e.key === 'ArrowDown' || e.key === 'PageDown' ? 1 : e.key === 'ArrowUp' || e.key === 'PageUp' ? -1 : 0;
      if (passo === 0 || e.ctrlKey || e.altKey || e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();
      irPara(stepIndex(activeRef.current, passo, total));
    };
    window.addEventListener('keydown', aoTeclar, true);
    return () => window.removeEventListener('keydown', aoTeclar, true);
  }, [irPara, total]);

  // O player ativo recebe o foco: espaço/K, ←/→, M e F funcionam sem clicar antes.
  useEffect(() => {
    if (commentsOpen) return;
    const alvo = scrollerRef.current?.querySelector<HTMLElement>(`[data-index="${active}"] [tabindex="0"]`);
    alvo?.focus({ preventScroll: true });
  }, [active, commentsOpen]);

  // A velocidade vale para o vídeo ativo na hora (e para os que carregarem depois: veja aplicarVelocidade).
  useEffect(() => {
    const video = scrollerRef.current?.querySelector<HTMLVideoElement>(`[data-index="${active}"] video`);
    if (video) video.playbackRate = speed;
  }, [active, speed]);

  const aplicarVelocidade = useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    if (video.playbackRate !== speedRef.current) video.playbackRate = speedRef.current;
  }, []);

  const lembrarSom = useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    soundRef.current = { muted: event.currentTarget.muted, volume: event.currentTarget.volume };
  }, []);

  const carregou = useCallback(
    (key: string | null) => (event: React.SyntheticEvent<HTMLVideoElement>) => {
      const video = event.currentTarget;
      aplicarVelocidade(event);
      // Vídeo que a pessoa nunca viu: herda o som que ela escolheu no anterior.
      if (soundRef.current && !videoPlaybackStore.get(key)) {
        video.muted = soundRef.current.muted;
        video.volume = soundRef.current.volume;
      }
    },
    [aplicarVelocidade],
  );

  const pedirLogin = useCallback((acao: string) => setLogin(acao), []);

  if (typeof document === 'undefined' || total === 0 || !entryAtiva) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Vídeos"
      data-testid="exelula-video-theater"
      className="fixed inset-0 z-[90] bg-black text-white"
      // Cliques e teclas daqui não sobem para o cartão (o cartão navega para o post ao ser tocado).
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div ref={scrollerRef} className="h-full w-full snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((entry, i) => {
          const chave = playbackKey(entry.postId, entry.url);
          return (
            <section
              key={entry.key}
              data-index={i}
              aria-roledescription={entry.mediaType === 'image' ? 'imagem' : 'vídeo'}
              aria-label={`Mídia ${i + 1} de ${total}`}
              className="relative h-[100dvh] w-full snap-start snap-always overflow-hidden bg-black"
            >
              {janela.has(i) && entry.mediaType === 'image' ? (
                <img
                  src={entry.url}
                  alt={entry.post.text?.slice(0, 120) || 'Imagem'}
                  className="h-full w-full object-contain select-none"
                />
              ) : janela.has(i) ? (
                <PlatformVideo
                  src={entry.url}
                  className="h-full w-full object-contain"
                  themed
                  controls
                  playsInline
                  loop
                  preload={i === active ? 'auto' : 'metadata'}
                  playbackKey={chave}
                  autoplayOnResume={i === inicio}
                  active={i === active}
                  onLoadedMetadata={carregou(chave)}
                  onPlay={aplicarVelocidade}
                  onVolumeChange={lembrarSom}
                />
              ) : null}
            </section>
          );
        })}
      </div>

      {/* VOLTAR: sempre visível, no canto superior esquerdo. */}
      <button
        type="button"
        onClick={() => onCloseRef.current()}
        aria-label="Voltar"
        data-testid="theater-back"
        className="absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-40 flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <ArrowLeft className="h-6 w-6" aria-hidden="true" />
      </button>

      {pendingTopItems.length > 0 && (
        <button
          type="button"
          onClick={aplicarNovasMidiasNoTopo}
          data-testid="theater-new-media-pill"
          className="absolute left-1/2 top-[max(0.75rem,env(safe-area-inset-top))] z-40 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-lg transition-transform active:scale-95 hover:brightness-110"
        >
          <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
          <span>
            {pendingTopItems.length === 1
              ? '1 nova mídia no topo'
              : `${pendingTopItems.length} novas mídias no topo`}
          </span>
        </button>
      )}

      <p className="pointer-events-none absolute left-1/2 top-[max(1.1rem,env(safe-area-inset-top))] z-10 -translate-x-1/2 text-xs font-medium text-white/80 [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]" aria-live="polite" data-testid="theater-position">
        {active + 1} / {total}
      </p>

      <div className="pointer-events-none absolute inset-x-0 bottom-[5.5rem] z-10 flex items-end justify-between gap-3 px-3">
        <TheaterAuthorInfo key={`autor-${entryAtiva.key}`} post={entryAtiva.post} onNeedLogin={pedirLogin} />
        <TheaterActionRail
          key={`acoes-${entryAtiva.key}`}
          post={entryAtiva.post}
          commentsBonus={extraComments[entryAtiva.postId] ?? 0}
          speed={speed}
          onSpeedChange={setSpeed}
          onOpenComments={() => setCommentsOpen(true)}
          onNeedLogin={pedirLogin}
        />
      </div>

      {commentsOpen && (
        <TheaterCommentsSheet
          key={`comentarios-${entryAtiva.postId}`}
          post={entryAtiva.post}
          onClose={() => setCommentsOpen(false)}
          onNeedLogin={pedirLogin}
          onCommentAdded={() => setExtraComments((anteriores) => ({ ...anteriores, [entryAtiva.postId]: (anteriores[entryAtiva.postId] ?? 0) + 1 }))}
        />
      )}

      {login && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-6" role="alertdialog" aria-label="Entrar" data-testid="theater-login">
          <div className="w-full max-w-sm rounded-2xl bg-background p-5 text-center text-foreground shadow-xl">
            <p className="text-base font-semibold">Entre para {login}</p>
            <p className="mt-1 text-sm text-muted-foreground">Crie sua conta ou entre para interagir com os vídeos.</p>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setLogin(null)} className="flex-1 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                Agora não
              </button>
              <Link href={`/${locale}/login`} className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Entrar
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
