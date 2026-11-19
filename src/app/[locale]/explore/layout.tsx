import type { ReactNode } from 'react';
import { buildPageMetadata } from '@/lib/seo/pageMetadata';

export const metadata = buildPageMetadata({
  title: 'Explorar a Rede',
  description: 'Descubra assuntos em alta, publicações recentes, vídeos e contas do HiperVerso, Fediverso e Bluesky.',
  badge: 'EXPLORAR',
  path: '/explore',
});

export default function ExploreLayout({ children }: { children: ReactNode }) {
  return children;
}

