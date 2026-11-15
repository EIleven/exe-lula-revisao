// This is the Root Layout and must be locale-agnostic

import type { Metadata, Viewport } from 'next';
import { Inter, Roboto_Mono } from 'next/font/google';
import Script from 'next/script';
import './globals.css';
import { consentModeBootstrapScript } from '@/lib/consent/consentState';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

const roboto_mono = Roboto_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

// Since this is a root layout, it doesn't have access to locale.
// Metadata should be defined in the locale-specific layout at src/app/[locale]/layout.tsx
// We keep basic structure here.
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html suppressHydrationWarning>
      <body className={`${inter.variable} ${roboto_mono.variable} antialiased font-sans`}>
        {/*
          Consent Mode v2 com tudo que é opcional NEGADO, antes de qualquer tag. Precisa ser `beforeInteractive` e
          precisa ficar no layout raiz: é o único ponto que roda antes de todo o resto, em qualquer página. Assim, se
          alguma tag do Google entrar no futuro sem passar pelo gate de consentimento, ela já encontra a negativa na
          fila em vez de medir à vontade.
        */}
        <Script id="google-consent-mode-default" strategy="beforeInteractive">
          {consentModeBootstrapScript()}
        </Script>
        {children}
      </body>
    </html>
  );
}
