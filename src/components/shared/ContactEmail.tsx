// src/components/shared/ContactEmail.tsx
import type { ReactNode } from 'react';
import { siteConfig } from '@/config/site';

type ContactChannel = 'support' | 'privacy' | 'accessibility';

interface ContactEmailProps {
  channel: ContactChannel;
  className?: string;
  /** O que mostrar enquanto a caixa de e-mail ainda não existe. */
  fallback: ReactNode;
}

/**
 * Link de e-mail de contato. Só anuncia o endereço quando a caixa existe de fato
 * (`siteConfig.contact.enabled`, hoje sempre verdadeiro — ver OWNER_CONTACT_EMAIL em src/config/site.ts); se algum
 * dia voltar a ser falso, mostra `fallback` em vez de divulgar um canal inexistente. O `fallback` continua existindo
 * por isso. Funciona em componentes de servidor e de cliente (não usa hooks).
 */
export default function ContactEmail({ channel, className, fallback }: ContactEmailProps) {
  if (!siteConfig.contact.enabled) return <>{fallback}</>;
  const address = siteConfig.contact[channel];
  return (
    <a href={`mailto:${address}`} className={className}>
      {address}
    </a>
  );
}
