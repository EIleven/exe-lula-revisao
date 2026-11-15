// src/app/[locale]/ads-info/page.tsx
// Esta página descrevia a publicidade no PRESENTE ("utilizamos publicidade como nossa principal fonte de receita",
// "trabalhamos com o Google AdSense") enquanto `siteConfig.adsEnabled` era false e nenhum anúncio era exibido — uma
// declaração incorreta no ar. Agora o texto acompanha a flag: desligada, a página diz que está desligada.
'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import BackButton from '@/components/shared/BackButton';
import PrivacyPreferencesButton from '@/components/consent/PrivacyPreferencesButton';
import { siteConfig } from '@/config/site';

export default function AdsInfoPage() {
  const adsOn = siteConfig.adsEnabled;

  return (
    <div className="container mx-auto max-w-3xl py-8">
      <BackButton />
      <Card className="shadow-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold">Informações de Anúncios</CardTitle>
          <CardDescription>Transparência sobre publicidade no Exe. Lula.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 text-foreground/90 prose prose-invert prose-p:text-foreground/90">
          {!adsOn && (
            <section>
              <h2 className="text-xl font-semibold mt-6 mb-2">Hoje a rede não exibe anúncios</h2>
              <p>
                Por decisão do responsável pela plataforma, a publicidade está <strong>desligada</strong>: nenhum
                anúncio é exibido e o script do Google AdSense <strong>não é nem baixado</strong> pelo seu navegador.
                O restante desta página explica o que passaria a valer caso a publicidade seja ligada algum dia.
              </p>
            </section>
          )}

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">
              {adsOn ? 'Por que exibimos anúncios?' : 'Por que a publicidade existiria'}
            </h2>
            <p>
              Manter a rede no ar custa dinheiro: servidores, desenvolvimento e moderação de conteúdo. A publicidade
              {adsOn ? ' é a forma escolhida para' : ' seria uma forma de'} cobrir esse custo sem cobrar das pessoas
              que usam a plataforma.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">Parceiro de anúncios</h2>
            <p>
              O parceiro {adsOn ? 'é' : 'seria'} o Google AdSense, que usa cookies para escolher os anúncios com base
              em visitas anteriores a este e a outros sites.
            </p>
            <p>
              <strong>Nada disso acontece sem o seu aceite.</strong> Os cookies de publicidade pertencem a uma
              categoria opcional, desligada por padrão: enquanto você não aceitar, o script do AdSense não é pedido e
              nenhum dado seu chega ao Google por esse caminho. Você decide e muda de ideia aqui:
            </p>
            <div className="not-prose mt-3">
              <PrivacyPreferencesButton variant="outline" />
            </div>
            <p className="mt-3">
              Também é possível desativar a publicidade personalizada direto nas{' '}
              <a
                href="https://www.google.com/settings/ads"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Configurações de anúncios do Google
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">Nosso compromisso</h2>
            <p>
              Anúncios enganosos, maliciosos ou de conteúdo adulto não são permitidos. Se a publicidade for ligada e
              você encontrar um anúncio que viole essas regras, denuncie.
            </p>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
