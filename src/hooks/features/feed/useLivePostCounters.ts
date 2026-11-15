'use client';

// src/hooks/features/feed/useLivePostCounters.ts
// Mantém os contadores de um cartão em tempo real, com custo controlado:
//  - só ouve enquanto o cartão está perto da tela (rootMargin de 400 px): num feed longo, os cartões que ficaram lá em cima
//    não mantêm ouvinte aberto;
//  - o ouvinte é COMPARTILHADO por post (postListenerRegistry.ts) e sobrevive 15 s sem observadores;
//  - só passam os campos de contador, e snapshot que veio do cache local (sem rede) é ignorado: ele traria um número mais
//    velho do que o da consulta que acabou de montar o cartão.
import { useEffect, useRef, useState, type RefObject } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { createPostListenerRegistry, type PostSubscribe } from '@/lib/feed/postListenerRegistry';
import { pickCounterFields } from '@/lib/feed/liveCounters';
import { scheduleRemotePostCountSync } from '@/lib/feed/remoteCountSync';

const subscribe: PostSubscribe = (key, onData, onError) => {
  const postId = key.slice(key.indexOf('|') + 1);
  return onSnapshot(
    doc(db, 'posts', postId),
    (snap) => {
      if (!snap.exists() || snap.metadata.fromCache) return;
      onData(pickCounterFields(snap.data()));
    },
    onError,
  );
};

let registry: ReturnType<typeof createPostListenerRegistry> | null = null;
const getRegistry = () => (registry ??= createPostListenerRegistry(subscribe));

/** Fecha todos os ouvintes de contador (troca de conta, saída). */
export function resetPostCounterListeners(): void {
  registry?.closeAll();
}

export function useLivePostCounters(
  postId: string | null | undefined,
  viewerId: string | null | undefined,
  targetRef: RefObject<Element | null>,
  onData: (data: Record<string, unknown>) => void,
): void {
  const [near, setNear] = useState(false);
  const callback = useRef(onData);
  callback.current = onData;

  useEffect(() => {
    const el = targetRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { rootMargin: '400px 0px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [targetRef]);

  useEffect(() => {
    if (!postId || !near) return;
    // A chave leva o visitante/conta: um ouvinte que falhou por falta de permissão não "gruda" depois de entrar numa conta.
    const stop = getRegistry().watch(`${viewerId ?? 'visitor'}|${postId}`, (data) => callback.current(data));
    // Post do Fediverso que acabou de chegar perto da tela: pede ao servidor que confira o número na origem (a fila junta os
    // cartões num lote só e o servidor respeita a validade). Depois do `watch`, para o ouvinte já estar de pé quando o número
    // novo for gravado. Para post local, não faz nada.
    scheduleRemotePostCountSync(postId);
    return stop;
  }, [postId, viewerId, near]);
}
