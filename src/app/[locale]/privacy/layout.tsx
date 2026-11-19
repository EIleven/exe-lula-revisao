import type { ReactNode } from 'react';
import { buildPageMetadata } from '@/lib/seo/pageMetadata';

export const metadata = buildPageMetadata({
  title: 'Política de Privacidade & LGPD',
  description: 'Entenda como protegemos seus dados, chat P2P sem banco de dados e seus direitos previstos na LGPD.',
  badge: 'PRIVACIDADE & LGPD',
  path: '/privacy',
});

export default function PrivacyLayout({ children }: { children: ReactNode }) {
  return children;
}

