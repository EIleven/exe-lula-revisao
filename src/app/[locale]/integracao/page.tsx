// src/app/[locale]/integracao/page.tsx
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { siteConfig } from '@/config/site';
import IntegrationDocsView from '@/components/integracao/IntegrationDocsView';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `Integração Técnica e Federação (BR) | ${siteConfig.name}`,
  description:
    'Documentação técnica de ActivityPub, WebFinger, NodeInfo 2.1, HTTP Signatures e código aberto AGPL-3.0 para instâncias, desenvolvedores e pesquisadores no Brasil.',
  robots: {
    index: true,
    follow: true,
  },
};

function isBrazilOrLocalAccess(headerList: Headers): { allowed: boolean; countryCode: string | null } {
  const rawCountry =
    headerList.get('x-appengine-country') ||
    headerList.get('cf-ipcountry') ||
    headerList.get('x-vercel-ip-country') ||
    headerList.get('x-country-code');

  if (!rawCountry) {
    return { allowed: true, countryCode: null };
  }

  const normalized = rawCountry.trim().toUpperCase();
  // 'ZZ' e 'XX' representam rede interna/desconhecida em proxies de desenvolvimento.
  if (normalized === 'BR' || normalized === 'ZZ' || normalized === 'XX') {
    return { allowed: true, countryCode: normalized };
  }

  return { allowed: false, countryCode: normalized };
}

export default async function IntegracaoPage() {
  const headerList = await headers();
  const { allowed, countryCode } = isBrazilOrLocalAccess(headerList);

  if (!allowed) {
    return (
      <div className="container mx-auto max-w-2xl py-16 px-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Acesso restrito ao Brasil</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              Esta documentação técnica de integração é disponibilizada exclusivamente para acessos originados no Brasil.
            </p>
            {countryCode ? (
              <p className="font-mono text-xs">Região detectada: {countryCode}</p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    );
  }

  const baseUrl = siteConfig.baseUrl.replace(/\/+$/, '');
  const host = new URL(baseUrl).host;

  return <IntegrationDocsView baseUrl={baseUrl} host={host} />;
}
