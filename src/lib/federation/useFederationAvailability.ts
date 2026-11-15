'use client';

import { useEffect, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import { getFederationStatus } from '@/lib/federation/client';

export type FederationAvailability = { loaded: boolean; available: boolean; acct: string | null };

const VALIDADE_MS = 60_000;
let cache: { uid: string; em: number; valor: FederationAvailability } | null = null;

/**
 * A pessoa pode escolher alcance de Fediverso agora? Só se a plataforma está ligada E ela ativou E não pausou.
 * Falha de rede = "indisponível": o compositor nunca oferece o que não sabe se vai funcionar.
 */
export function useFederationAvailability(firebaseUser: FirebaseUser | null): FederationAvailability {
  const [valor, setValor] = useState<FederationAvailability>(() =>
    cache && firebaseUser && cache.uid === firebaseUser.uid && Date.now() - cache.em < VALIDADE_MS ? cache.valor : { loaded: false, available: false, acct: null });

  useEffect(() => {
    if (!firebaseUser) return;
    if (cache && cache.uid === firebaseUser.uid && Date.now() - cache.em < VALIDADE_MS) { setValor(cache.valor); return; }
    let ativo = true;
    getFederationStatus(firebaseUser)
      .then((s) => {
        const v = { loaded: true, available: s.platformEnabled && s.enabled && !s.paused, acct: s.acct };
        cache = { uid: firebaseUser.uid, em: Date.now(), valor: v };
        if (ativo) setValor(v);
      })
      .catch(() => { if (ativo) setValor({ loaded: true, available: false, acct: null }); });
    return () => { ativo = false; };
  }, [firebaseUser]);

  return valor;
}

/** Depois de ativar, pausar ou desligar, o compositor precisa ver o estado novo e não o do cache. */
export function invalidateFederationAvailability() {
  cache = null;
}
