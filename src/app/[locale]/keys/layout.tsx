import type { ReactNode } from 'react';
import { buildPageMetadata } from '@/lib/seo/pageMetadata';

export const metadata = buildPageMetadata({
  title: 'Identidade P2P & Cofre 2FA',
  description: 'Gerencie sua biometria, aparelhos pareados e códigos 2FA (TOTP) por QR Code direto no seu dispositivo.',
  badge: 'CHAVES & COFRE 2FA',
  path: '/keys',
});

export default function KeysLayout({ children }: { children: ReactNode }) {
  return children;
}

