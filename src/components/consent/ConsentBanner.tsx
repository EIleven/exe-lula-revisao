// src/components/consent/ConsentBanner.tsx
'use client';

import React from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useConsent } from '@/hooks/features/consent/useConsent';

/**
 * Aviso de cookies. Aparece só enquanto não há decisão válida para a versão atual do aviso.
 *
 * "Aceitar tudo" e "Rejeitar tudo" são o MESMO botão em tamanho, cor e posição de leitura: recusar custa um clique,
 * igual a aceitar. Isso não é estética, é requisito — um botão de recusa escondido ou apagado invalida o
 * consentimento (LGPD, art. 8º: manifestação livre, informada e inequívoca). Não mexa nos pesos sem ler isso.
 *
 * O banner não bloqueia a leitura: dá para rolar e ler a rede antes de decidir, e enquanto não decidir nada opcional
 * carrega. No celular ele fica sobre a barra inferior até a pessoa escolher (um toque resolve) — vale conferir no
 * aparelho se o resultado agrada.
 */
export default function ConsentBanner() {
  const t = useTranslations('Consent');
  const locale = useLocale();
  const { needsDecision, isReady, acceptAll, rejectAll, openPreferences } = useConsent();

  if (!isReady || !needsDecision) return null;

  return (
    <div
      role="region"
      aria-labelledby="consent-banner-title"
      className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
      <div
        className="mx-auto max-w-3xl space-y-3 p-4"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
      >
        <h2 id="consent-banner-title" className="text-base font-semibold text-foreground">
          {t('title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
        <p className="text-xs text-muted-foreground">
          <Link href={`/${locale}/cookies`} className="text-primary hover:underline">
            {t('cookiePolicy')}
          </Link>
          {' · '}
          <Link href={`/${locale}/privacy`} className="text-primary hover:underline">
            {t('privacyPolicy')}
          </Link>
        </p>
        {/* Os dois primeiros botões são idênticos de propósito: aceitar e recusar com o mesmo destaque. */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={acceptAll} className="flex-1">
            {t('acceptAll')}
          </Button>
          <Button onClick={rejectAll} className="flex-1">
            {t('rejectAll')}
          </Button>
          <Button variant="outline" onClick={openPreferences} className="flex-1">
            {t('customize')}
          </Button>
        </div>
      </div>
    </div>
  );
}
