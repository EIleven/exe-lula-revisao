// src/hooks/useOptimisticToggle.ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_GRACE_MS,
  AGREE_RELEASE_MS,
  displayState,
  expectedServerAfterWrite,
  flipOverlay,
  markWritten,
  needsWrite,
  startOverlay,
  type ServerToggleState,
  type ToggleOverlay,
} from '@/lib/interactions/optimisticToggle';

interface UseOptimisticToggleOptions<T> {
  /** Estado do servidor de um item (curtido ou não, e o contador). */
  read: (item: T) => ServerToggleState;
  /** Cópia do item com o estado a mostrar. */
  write: (item: T, state: ServerToggleState) => T;
  /** Grava o estado FINAL no servidor. Idempotente; lança erro se falhar. */
  persist: (desired: boolean) => Promise<void>;
  /** Chamado quando a gravação falha (o que se mostra já voltou ao último estado gravado). */
  onFailure: (error: unknown) => void;
  /** Chamado quando a fila terminou de gravar, com o estado final que ficou no servidor. */
  onSettled?: (finalState: boolean) => void;
  /** Quanto o servidor pode demorar para refletir o toque antes de valer só o que ele diz. */
  graceMs?: number;
  /**
   * Tela SEM listener ao vivo (o botão de seguir): ninguém avisa quando o servidor alcança o toque. Com isto, depois que a fila
   * grava tudo, o estado gravado e o contador esperado passam a valer como o do servidor, e a tela não volta ao de partida.
   */
  assumeServerAfterWrite?: boolean;
}

/**
 * Interação de liga/desliga (curtir, repostar, salvar) com resposta IMEDIATA:
 *  - o toque muda a tela no mesmo instante, sem desabilitar o botão e sem perder toques rápidos;
 *  - toques em sequência viram UMA gravação do estado final (nada de ler e depois gravar a cada toque);
 *  - dados atrasados do servidor (o contador só é gravado por uma Function segundos depois) não desfazem o toque: veja
 *    `reconcile` e src/lib/interactions/optimisticToggle.ts;
 *  - se a gravação falha, volta ao último estado que o servidor confirmou e avisa.
 */
export function useOptimisticToggle<T>(
  getItem: () => T,
  setItem: (update: (prev: T) => T) => void,
  options: UseOptimisticToggleOptions<T>,
) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const getItemRef = useRef(getItem);
  getItemRef.current = getItem;
  const setItemRef = useRef(setItem);
  setItemRef.current = setItem;

  const overlayRef = useRef<ToggleOverlay | null>(null);
  const serverRef = useRef<ServerToggleState | null>(null);
  const flushingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const server = useCallback((): ServerToggleState => {
    if (!serverRef.current) serverRef.current = optionsRef.current.read(getItemRef.current());
    return serverRef.current;
  }, []);

  /** Mostra na tela o estado que resulta do overlay atual. */
  const paint = useCallback(() => {
    const overlay = overlayRef.current;
    const { write, graceMs } = optionsRef.current;
    const now = Date.now();
    if (!overlay) {
      setItemRef.current((prev) => write(prev, server()));
      return;
    }
    const shown = displayState(overlay, server(), now, graceMs ?? DEFAULT_GRACE_MS);
    if (shown.release) {
      overlayRef.current = null;
      setItemRef.current((prev) => write(prev, server()));
      if (mountedRef.current) setPending(false);
      return;
    }
    setItemRef.current((prev) => write(prev, { active: shown.active, count: shown.count }));
  }, [server]);

  /** Reavalia mais tarde para soltar o overlay mesmo que nenhum dado novo chegue do servidor. */
  const scheduleRelease = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const overlay = overlayRef.current;
    if (!overlay) return;
    const graceMs = optionsRef.current.graceMs ?? DEFAULT_GRACE_MS;
    const wait = Math.max(200, Math.min(AGREE_RELEASE_MS, graceMs) + 50);
    timerRef.current = setTimeout(() => {
      if (!mountedRef.current || !overlayRef.current) return;
      paint();
      if (overlayRef.current) scheduleRelease();
    }, wait);
  }, [paint]);

  const flush = useCallback(async () => {
    if (flushingRef.current) return;
    flushingRef.current = true;
    try {
      while (overlayRef.current && needsWrite(overlayRef.current)) {
        const target = overlayRef.current.desired;
        try {
          await optionsRef.current.persist(target);
        } catch (error) {
          // Volta ao último estado CONFIRMADO no servidor (o que foi gravado antes desta falha) e avisa.
          const overlay = overlayRef.current;
          overlayRef.current = null;
          if (overlay) {
            const confirmed: ToggleOverlay = { ...overlay, desired: overlay.written, settled: true };
            const shown = displayState(confirmed, server(), Date.now(), Number.MAX_SAFE_INTEGER);
            setItemRef.current((prev) => optionsRef.current.write(prev, { active: shown.active, count: shown.count }));
          }
          if (mountedRef.current) setPending(false);
          optionsRef.current.onFailure(error);
          return;
        }
        if (overlayRef.current) overlayRef.current = markWritten(overlayRef.current, target);
      }
      if (mountedRef.current) setPending(false);
      if (optionsRef.current.assumeServerAfterWrite && overlayRef.current) {
        // Só com a fila parada (desejado == gravado): no meio dela o contador esperado seria o do toque anterior.
        serverRef.current = expectedServerAfterWrite(overlayRef.current, overlayRef.current.written);
      }
      scheduleRelease();
      if (overlayRef.current) optionsRef.current.onSettled?.(overlayRef.current.written);
    } finally {
      flushingRef.current = false;
    }
  }, [scheduleRelease, server]);

  /** O toque. Muda a tela AGORA e grava o estado final em segundo plano. */
  const toggle = useCallback(() => {
    const now = Date.now();
    const base = overlayRef.current ?? startOverlay(server(), now);
    overlayRef.current = flipOverlay(base, now);
    if (mountedRef.current) setPending(true);
    paint();
    void flush();
  }, [flush, paint, server]);

  /**
   * Para o listener do servidor: recebe o item como o servidor o mostra e devolve o que a TELA deve mostrar (o toque da
   * pessoa continua valendo enquanto o servidor não o alcança). Sem overlay, devolve o item como veio.
   */
  const reconcile = useCallback((fresh: T): T => {
    const { read, write, graceMs } = optionsRef.current;
    serverRef.current = read(fresh);
    const overlay = overlayRef.current;
    if (!overlay) return fresh;
    const shown = displayState(overlay, serverRef.current, Date.now(), graceMs ?? DEFAULT_GRACE_MS);
    if (shown.release) {
      overlayRef.current = null;
      if (mountedRef.current) setPending(false);
      return fresh;
    }
    return write(fresh, { active: shown.active, count: shown.count });
  }, []);

  /** Informa um novo estado do servidor vindo de fora (por exemplo, o item da lista foi trocado). */
  const resetServer = useCallback((item: T) => {
    serverRef.current = optionsRef.current.read(item);
  }, []);

  /**
   * Esquece o toque pendente e o estado do servidor. Para quando o MESMO hook passa a servir outro item (o perfil aberto mudou
   * de uma pessoa para outra): o toque em uma não pode ser aplicado à outra. Uma gravação já em andamento termina sozinha.
   */
  const reset = useCallback(() => {
    overlayRef.current = null;
    serverRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (mountedRef.current) setPending(false);
  }, []);

  return { toggle, reconcile, resetServer, reset, pending };
}
