import type { ReactNode } from 'react';
import { buildPageMetadata } from '@/lib/seo/pageMetadata';

export const metadata = buildPageMetadata({
  title: 'Termos de Uso & Diretrizes',
  description: 'Regras da comunidade, proteção contra bots de IA e compromissos de convivência na plataforma.',
  badge: 'TERMOS DE USO',
  path: '/terms',
});

export default function TermsLayout({ children }: { children: ReactNode }) {
  return children;
}

