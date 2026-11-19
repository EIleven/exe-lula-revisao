// src/hooks/useHiperChatPreferences.ts
// A ponte entre o módulo puro (lib/hiperchat/preferences.ts) e as telas do HiperChat.
//
// Por que um aviso próprio: mudar o tamanho do texto em Configurações tem de aparecer na MESMA hora, e quem desenha a
// moldura (HiperChatShell) não é quem salva (a tela de Configurações). O `localStorage` não avisa ninguém na própria aba —
// o evento `storage` do navegador só chega às OUTRAS abas. Então quem salva dispara `hv:hiperchat-prefs` e todo mundo relê.

'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  alternarFixada,
  lerFixadas,
  lerPreferencias,
  migrarPreferenciasAntigas,
  salvarPreferencias,
  PREFERENCIAS_PADRAO,
  type HiperChatPreferences,
} from '@/lib/hiperchat/preferences';

export const EVENTO_PREFERENCIAS = 'hv:hiperchat-prefs';
export const EVENTO_FIXADAS = 'hv:hiperchat-fixadas';

const avisar = (nome: string) => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(nome));
};

/** As preferências deste aparelho, já relidas quando outra tela (ou outra aba) as muda. */
export function useHiperChatPreferences(uid: string | null | undefined) {
  const [preferencias, setPreferencias] = useState<HiperChatPreferences>(PREFERENCIAS_PADRAO);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // A migração roda uma vez por conta e já devolve o valor certo (quem usava a versão anterior não perde as escolhas).
    setPreferencias(migrarPreferenciasAntigas(window.localStorage, uid));
    const reler = () => setPreferencias(lerPreferencias(window.localStorage, uid));
    window.addEventListener(EVENTO_PREFERENCIAS, reler);
    window.addEventListener('storage', reler);
    return () => {
      window.removeEventListener(EVENTO_PREFERENCIAS, reler);
      window.removeEventListener('storage', reler);
    };
  }, [uid]);

  const salvar = useCallback(
    (mudanca: Partial<HiperChatPreferences>) => {
      if (typeof window === 'undefined') return;
      setPreferencias(salvarPreferencias(window.localStorage, uid, mudanca));
      avisar(EVENTO_PREFERENCIAS);
    },
    [uid],
  );

  return { preferencias, salvar };
}

/** As conversas fixadas desta pessoa neste aparelho, na ordem em que foram fixadas. */
export function useHiperChatPins(uid: string | null | undefined) {
  const [fixadas, setFixadas] = useState<readonly string[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setFixadas(lerFixadas(window.localStorage, uid));
    const reler = () => setFixadas(lerFixadas(window.localStorage, uid));
    window.addEventListener(EVENTO_FIXADAS, reler);
    window.addEventListener('storage', reler);
    return () => {
      window.removeEventListener(EVENTO_FIXADAS, reler);
      window.removeEventListener('storage', reler);
    };
  }, [uid]);

  const alternar = useCallback(
    (conversationId: string) => {
      if (typeof window === 'undefined') return;
      setFixadas(alternarFixada(window.localStorage, uid, conversationId));
      avisar(EVENTO_FIXADAS);
    },
    [uid],
  );

  return { fixadas, alternar };
}
