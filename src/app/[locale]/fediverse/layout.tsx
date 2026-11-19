import type { ReactNode } from 'react';
import { buildPageMetadata } from '@/lib/seo/pageMetadata';

export const metadata = buildPageMetadata({
  title: 'Fediverso (ActivityPub)',
  description: 'Busque e acompanhe perfis do Mastodon, Pixelfed e outras redes abertas diretamente pelo HiperVerso.',
  badge: 'FEDIVERSO',
  path: '/fediverse',
});

export default function FediverseLayout({ children }: { children: ReactNode }) {
  return children;
}

