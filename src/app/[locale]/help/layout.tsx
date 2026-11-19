import type { ReactNode } from 'react';
import { buildPageMetadata } from '@/lib/seo/pageMetadata';

export const metadata = buildPageMetadata({
  title: 'Central de Ajuda',
  description: 'Guias rápidos para usar o feed, chat P2P, federação, cofre 2FA e o aplicativo Android.',
  badge: 'AJUDA',
  path: '/help',
});

export default function HelpLayout({ children }: { children: ReactNode }) {
  return children;
}

