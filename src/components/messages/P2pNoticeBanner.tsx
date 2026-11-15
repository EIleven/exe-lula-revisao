'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { Wifi, ShieldCheck, Settings, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { getP2pPreferences, saveP2pPreferences } from '@/lib/p2p/p2pPreferences';

const DISMISS_PREFIX = 'exelula:p2p-notice-dismissed:v1:';

interface P2pNoticeBannerProps {
  userId: string;
  compact?: boolean;
  className?: string;
  onDefaultEnabled?: () => void;
}

/**
 * Aviso explicativo único e não invasivo sobre a comunicação P2P (Zero DB)
 * e controle total dos dados pelo usuário (Entrada, Saída e exclusão local).
 */
export default function P2pNoticeBanner({
  userId,
  compact = false,
  className,
  onDefaultEnabled,
}: P2pNoticeBannerProps) {
  const locale = useLocale();
  const { toast } = useToast();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !userId) return;
    try {
      const dismissed = window.localStorage.getItem(`${DISMISS_PREFIX}${userId}`);
      if (!dismissed) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, [userId]);

  const dismiss = () => {
    if (typeof window !== 'undefined' && userId) {
      try {
        window.localStorage.setItem(`${DISMISS_PREFIX}${userId}`, String(Date.now()));
      } catch {
        // ignore
      }
    }
    setVisible(false);
  };

  const enableDefaultP2p = () => {
    const current = getP2pPreferences(userId);
    saveP2pPreferences(userId, { ...current, defaultZeroDbOnly: true, autoConnectP2p: true });
    onDefaultEnabled?.();
    dismiss();
    toast({
      title: 'P2P (Zero DB) ativado como padrão',
      description: 'Suas conversas 1-a-1 agora priorizam entrega direta dispositivo a dispositivo sem gravar no banco.',
    });
  };

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="Aviso sobre comunicação P2P e controle de dados"
      className={cn(
        'relative rounded-xl border border-emerald-500/30 bg-emerald-500/5 text-left shadow-sm',
        compact ? 'p-3' : 'p-4',
        className,
      )}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Fechar aviso"
        className="absolute right-2.5 top-2.5 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex items-start gap-3 pr-6">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
          <Wifi className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <span>Mensagens P2P (Zero DB) e Controle de Dados</span>
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Quando você e seu contato estão online, o chat conecta <strong>direto aparelho com aparelho</strong> com criptografia ponta a ponta (ECDH + AES-GCM), sem passar pelo banco de dados. O histórico P2P fica apenas no seu dispositivo — você pode <strong>exportar, importar ou apagar</strong> tudo a qualquer momento.
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              onClick={enableDefaultP2p}
              className="h-7 rounded-full bg-emerald-600 px-3 text-xs text-white hover:bg-emerald-500"
            >
              Usar P2P como padrão
            </Button>
            <Button type="button" size="sm" variant="outline" asChild className="h-7 rounded-full px-3 text-xs">
              <Link href={`/${locale}/settings/p2p`}>
                <Settings className="mr-1.5 h-3 w-3" />
                Configurações P2P
              </Link>
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={dismiss} className="h-7 rounded-full px-2.5 text-xs">
              Entendi
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

