'use client';

import { useEffect, useRef } from 'react';
import { deveAvisar, tocarAviso, type ContextoDeAudioLike } from '@/lib/hiperchat/som';

type ConstrutorDeContexto = new () => AudioContext;

const obterConstrutor = (): ConstrutorDeContexto | undefined => {
  if (typeof window === 'undefined') return undefined;
  const janela = window as unknown as { AudioContext?: ConstrutorDeContexto; webkitAudioContext?: ConstrutorDeContexto };
  return janela.AudioContext ?? janela.webkitAudioContext;
};

/**
 * Apita quando o total de mensagens não lidas sobe.
 *
 * O contexto de áudio nasce só no primeiro aviso e é reaproveitado: criar um por mensagem estoura o limite do
 * navegador. Quando `ativo` é falso nada é criado — quem desligou o som no aparelho não paga nem o contexto.
 */
export function useAvisoSonoro(naoLidas: number, ativo: boolean): void {
  const anterior = useRef<number | null>(null);
  const contexto = useRef<AudioContext | null>(null);

  useEffect(() => {
    const antes = anterior.current;
    anterior.current = naoLidas;
    if (!ativo) return;
    if (!deveAvisar(antes, naoLidas)) return;

    if (!contexto.current) {
      const Construtor = obterConstrutor();
      if (!Construtor) return;
      try {
        contexto.current = new Construtor();
      } catch {
        return;
      }
    }
    tocarAviso(contexto.current as unknown as ContextoDeAudioLike);
  }, [naoLidas, ativo]);

  // Ao sair, devolve o contexto: cada um segura uma saída de áudio do sistema.
  useEffect(() => () => {
    try {
      void contexto.current?.close();
    } catch {
      /* navegador sem suporte ou já fechado */
    }
    contexto.current = null;
  }, []);
}
