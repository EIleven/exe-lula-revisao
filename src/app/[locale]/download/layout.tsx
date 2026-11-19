import type { ReactNode } from 'react';
import { buildPageMetadata } from '@/lib/seo/pageMetadata';

export const metadata = buildPageMetadata({
  title: 'Baixar App Android (APK Oficial)',
  description: 'Instale o aplicativo oficial do HiperVerso com biometria nativa, cofre 2FA, chat P2P e atualizações diretas.',
  badge: 'APP ANDROID',
  path: '/download',
});

export default function DownloadLayout({ children }: { children: ReactNode }) {
  return children;
}

