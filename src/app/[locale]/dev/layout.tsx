import type { ReactNode } from 'react';
import { buildPageMetadata } from '@/lib/seo/pageMetadata';

export const metadata = buildPageMetadata({
  title: 'HiperVerso DEV & Revisão Técnica',
  description: 'Especificações de federação ActivityPub/ATProto, arquitetura WebRTC P2P e repositório público de revisão técnica.',
  badge: 'DEV & ARQUITETURA',
  path: '/dev',
});

export default function DevLayout({ children }: { children: ReactNode }) {
  return children;
}

