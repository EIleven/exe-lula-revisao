import type { ReactNode } from 'react';
import { buildPageMetadata } from '@/lib/seo/pageMetadata';

export const metadata = buildPageMetadata({
  title: 'Sobre o HiperVerso',
  description: 'Conheça a rede social brasileira soberana, livre de venda de dados e conectada ao Fediverso e Bluesky.',
  badge: 'SOBRE A REDE',
  path: '/about',
});

export default function AboutLayout({ children }: { children: ReactNode }) {
  return children;
}

