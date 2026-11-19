'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { KeyRound, QrCode, X } from 'lucide-react';
import { useCurrentUser } from '@/contexts/CurrentUserContext';

const DISMISS_KEY = 'exelula_keys_banner_dismissed_v1';

export default function SovereignKeysBanner() {
  const { currentUser } = useCurrentUser();
  const locale = useLocale();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!currentUser?.id || typeof window === 'undefined') return;
    try {
      const dismissed = window.localStorage.getItem(`${DISMISS_KEY}:${currentUser.id}`);
      if (!dismissed) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, [currentUser?.id]);

  if (!visible || !currentUser?.id) return null;

  const dismiss = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(`${DISMISS_KEY}:${currentUser.id}`, '1');
    } catch {
      // ignora
    }
  };

  return (
    <div className="mx-3 my-2.5 rounded-xl border border-primary/30 bg-primary/5 px-3.5 py-2.5 text-xs flex items-start justify-between gap-3">
      <div className="flex items-start gap-2.5 min-w-0">
        <div className="mt-0.5 rounded-lg bg-primary/15 p-1.5 text-primary shrink-0">
          <KeyRound className="h-4 w-4" />
        </div>
        <div className="space-y-1 min-w-0">
          <p className="font-bold text-foreground">
            Novidade no HiperVerso: Chaves Soberanas P2P &amp; Passe QR
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Gere suas próprias chaves locais entre aparelhos autorizados, faça login via QR Code em
            qualquer aplicação e bloqueie provedores quando quiser, com controle 100% seu.
          </p>
          <Link
            href={`/${locale}/keys`}
            className="inline-flex items-center gap-1 font-semibold text-primary hover:underline pt-0.5"
          >
            <QrCode className="h-3.5 w-3.5" />
            Configurar minhas Chaves P2P &amp; Passe QR
          </Link>
        </div>
      </div>

      <button
        type="button"
        onClick={dismiss}
        aria-label="Fechar aviso"
        className="text-muted-foreground hover:text-foreground p-1 rounded-md shrink-0"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

