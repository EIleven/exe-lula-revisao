// src/hooks/usePreferenciasDeBusca.ts
'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  PREFERENCIAS_PADRAO,
  esquecerBusca,
  lerHistorico,
  lerPreferencias,
  limparHistorico,
  registrarBusca,
  salvarPreferencias,
  type PreferenciasDeBusca,
} from '@/lib/search/preferenciasDeBusca';

/**
 * A ponte entre o módulo puro das preferências de busca e as telas.
 *
 * Aviso próprio pelo mesmo motivo das preferências do HiperChat: o `localStorage` não avisa ninguém na própria aba
 * (o evento `storage` do navegador só chega às OUTRAS abas). Quem salva dispara `hv:busca-prefs` e todo mundo relê,
 * para a mudança feita em Configurações aparecer na busca na mesma hora.
 */
export const EVENTO_PREFERENCIAS_DE_BUSCA = 'hv:busca-prefs';

const avisar = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO_PREFERENCIAS_DE_BUSCA));
};

const armazenamento = () => (typeof window === 'undefined' ? null : window.localStorage);

export function usePreferenciasDeBusca(uid: string | null | undefined) {
  const [preferencias, setPreferencias] = useState<PreferenciasDeBusca>(PREFERENCIAS_PADRAO);
  const [historico, setHistorico] = useState<string[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const reler = () => {
      setPreferencias(lerPreferencias(window.localStorage, uid));
      setHistorico(lerHistorico(window.localStorage, uid));
    };
    reler();
    window.addEventListener(EVENTO_PREFERENCIAS_DE_BUSCA, reler);
    window.addEventListener('storage', reler);
    return () => {
      window.removeEventListener(EVENTO_PREFERENCIAS_DE_BUSCA, reler);
      window.removeEventListener('storage', reler);
    };
  }, [uid]);

  const salvar = useCallback(
    (mudanca: Partial<PreferenciasDeBusca>) => {
      const novo = salvarPreferencias(armazenamento(), uid, mudanca);
      setPreferencias(novo);
      setHistorico(lerHistorico(armazenamento(), uid));
      avisar();
      return novo;
    },
    [uid],
  );

  const registrar = useCallback(
    (consulta: string) => {
      setHistorico(registrarBusca(armazenamento(), uid, consulta));
      avisar();
    },
    [uid],
  );

  const limpar = useCallback(() => {
    limparHistorico(armazenamento(), uid);
    setHistorico([]);
    avisar();
  }, [uid]);

  const esquecer = useCallback(
    (consulta: string) => {
      setHistorico(esquecerBusca(armazenamento(), uid, consulta));
      avisar();
    },
    [uid],
  );

  return { preferencias, historico, salvar, registrar, limpar, esquecer };
}
