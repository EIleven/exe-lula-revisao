// src/components/consent/PrivacyPreferencesButton.tsx
'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useConsent } from '@/hooks/features/consent/useConsent';

/**
 * Entrada permanente para o painel de consentimento. Precisa existir em lugar fixo e alcançável de qualquer página:
 * sem um caminho de volta, a escolha deixaria de ser revogável (LGPD, art. 8º, § 5º).
 *
 * `variant="link"` serve ao rodapé (ao lado de Termos e Privacidade); os outros, às telas de configuração.
 */
export default function PrivacyPreferencesButton({
  variant = 'link',
  className,
  label,
}: {
  variant?: 'link' | 'outline' | 'ghost';
  className?: string;
  /** Texto do botão quando o rótulo já aparece ao lado (ex.: uma linha de configuração). */
  label?: React.ReactNode;
}) {
  const t = useTranslations('Consent');
  const { openPreferences } = useConsent();

  return (
    <Button variant={variant} size="sm" onClick={openPreferences} className={className}>
      {label ?? t('openPreferences')}
    </Button>
  );
}
