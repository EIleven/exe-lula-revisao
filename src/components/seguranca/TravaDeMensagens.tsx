'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { Fingerprint, Loader2, LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { getE2eeStatus } from '@/lib/crypto/e2ee';
import { logoutUser as serverLogoutUser } from '@/lib/services/authService';
import { pedirDigital } from '@/lib/seguranca/pedirDigital';
import {
  lerEscolha,
  precisaPedirDeNovo,
  temDigitalCadastrada,
  travaAtiva,
} from '@/lib/seguranca/travaDeTela';

type Estado = 'decidindo' | 'trancado' | 'aberto';

/**
 * Tranca a área de mensagens atrás da digital para quem tem chave E2EE e digital cadastradas neste aparelho.
 *
 * A ordem aqui importa: começa em 'decidindo' e NUNCA mostra as conversas enquanto não souber. Se começasse
 * aberto e trancasse depois, a lista apareceria por um instante — e um instante é tudo de que precisa quem
 * está olhando por cima do ombro.
 */
export default function TravaDeMensagens({ children }: { children: React.ReactNode }) {
  const { currentUser, logout } = useCurrentUser();
  const uid = currentUser?.id;
  const router = useRouter();
  const locale = useLocale();
  const { toast } = useToast();

  const [estado, setEstado] = useState<Estado>('decidindo');
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [mostrarSaida, setMostrarSaida] = useState(false);
  const escondidoDesde = useRef<number | null>(null);

  // Decide o estado inicial. O caminho rápido é síncrono: sem digital cadastrada não há trava possível, e a
  // esmagadora maioria entra direto, sem esperar nada.
  useEffect(() => {
    let cancelado = false;
    if (!uid) {
      setEstado('aberto');
      return;
    }
    const armazenamento = typeof window === 'undefined' ? null : window.localStorage;
    const temDigital = temDigitalCadastrada(armazenamento, uid);
    const escolha = lerEscolha(armazenamento, uid);
    if (!temDigital || escolha === false) {
      setEstado('aberto');
      return;
    }
    // Tem digital e não desligou: assume trancado e só então confirma se há mesmo chave E2EE aqui.
    setEstado('trancado');
    void (async () => {
      try {
        const identidade = await getE2eeStatus(uid);
        if (cancelado) return;
        const ativa = travaAtiva({ temChaveE2ee: identidade.status === 'ready', temDigital, escolha });
        if (!ativa) setEstado('aberto');
      } catch {
        // Sem conseguir ler o estado da chave, destrancar é pior que pedir a digital uma vez.
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [uid]);

  // Trancar de novo quando o app passou tempo demais em segundo plano: é aí que o aparelho troca de mão.
  useEffect(() => {
    if (estado !== 'aberto') return;
    const aoTrocarVisibilidade = () => {
      if (document.visibilityState === 'hidden') {
        escondidoDesde.current = Date.now();
        return;
      }
      if (precisaPedirDeNovo({ escondidoDesde: escondidoDesde.current, agora: Date.now() })) {
        const armazenamento = typeof window === 'undefined' ? null : window.localStorage;
        if (uid && temDigitalCadastrada(armazenamento, uid) && lerEscolha(armazenamento, uid) !== false) {
          setEstado('trancado');
          setAviso(null);
        }
      }
      escondidoDesde.current = null;
    };
    document.addEventListener('visibilitychange', aoTrocarVisibilidade);
    return () => document.removeEventListener('visibilitychange', aoTrocarVisibilidade);
  }, [estado, uid]);

  const abrir = useCallback(async () => {
    if (ocupado) return;
    setOcupado(true);
    setAviso(null);
    try {
      const r = await pedirDigital({
        titulo: 'Abrir suas mensagens',
        subtitulo: 'Use sua digital, rosto ou senha do aparelho',
      });
      if (r.ok) {
        setEstado('aberto');
        escondidoDesde.current = null;
        return;
      }
      // Se o aparelho perdeu a capacidade de pedir digital, trancar para sempre seria tomar as mensagens da
      // pessoa. Ela entra, e a tela diz o que aconteceu para ela decidir o que fazer.
      if (r.motivo === 'indisponivel') {
        setEstado('aberto');
        toast({
          title: 'Trava desligada neste aparelho',
          description: `${r.mensagem} Configure a digital no sistema para voltar a trancar.`,
        });
        return;
      }
      setAviso(r.mensagem);
    } finally {
      setOcupado(false);
    }
  }, [ocupado, toast]);

  const sair = async () => {
    try {
      await serverLogoutUser();
      logout();
    } catch {
      // Mesmo falhando no servidor, o estado local sai.
      logout();
    }
    router.push(`/${locale}/login`);
  };

  if (estado === 'aberto') return <>{children}</>;

  if (estado === 'decidindo') {
    return <div className="w-full flex-1" aria-hidden="true" />;
  }

  return (
    <div className="flex w-full flex-1 items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-xs flex-col items-center text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-primary/10 text-primary">
          <LockKeyhole className="h-7 w-7" />
        </span>
        <h2 className="mt-4 text-base font-semibold text-foreground">Mensagens trancadas</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Use sua digital para abrir. Quem pegar este aparelho não lê suas conversas.
        </p>

        <Button type="button" onClick={abrir} disabled={ocupado} className="mt-5 h-11 w-full rounded-full">
          {ocupado ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Fingerprint className="mr-2 h-5 w-5" />}
          {ocupado ? 'Aguardando…' : 'Desbloquear'}
        </Button>

        {aviso && (
          <p className="mt-3 text-xs text-destructive" role="alert">
            {aviso}
          </p>
        )}

        {!mostrarSaida ? (
          <button
            type="button"
            onClick={() => setMostrarSaida(true)}
            className="mt-4 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Não consigo usar a digital
          </button>
        ) : (
          <div className="mt-4 rounded-xl border border-border/80 bg-muted/40 p-3 text-left">
            <p className="text-xs text-muted-foreground">
              A trava vive neste aparelho. Para entrar sem ela, saia da conta e entre de novo — aí você pode
              desligar a trava nas Configurações.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={sair} className="mt-2 h-8 w-full rounded-full text-xs">
              Sair da conta
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
