// src/app/[locale]/accessibility/page.tsx
'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import BackButton from '@/components/shared/BackButton';
import ContactEmail from '@/components/shared/ContactEmail';

export default function AccessibilityPage() {
  return (
    <div className="container mx-auto max-w-3xl py-8">
      <BackButton />
      <Card className="shadow-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold">Declaração de Acessibilidade</CardTitle>
          <CardDescription>
            O HiperVerso está comprometido em garantir a acessibilidade digital para pessoas com deficiência.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 text-foreground/90 prose prose-invert prose-p:text-foreground/90">
          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">Nosso Compromisso</h2>
            <p>
              Estamos continuamente melhorando a experiência do usuário para todos e aplicando os padrões de acessibilidade relevantes. Nosso objetivo é estar em conformidade com as Diretrizes de Acessibilidade para Conteúdo Web (WCAG) 2.1 nível AA.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">Medidas Tomadas</h2>
            <p>
              A acessibilidade é parte integrante de nossa missão. Algumas das medidas que tomamos incluem:
            </p>
            <ul className="list-disc list-inside space-y-1 mt-2">
              <li>Garantir a navegação por teclado.</li>
              <li>Fornecer texto alternativo para imagens.</li>
              <li>Manter um contraste de cores adequado.</li>
              <li>Usar marcação HTML semântica para ajudar tecnologias assistivas.</li>
            </ul>
          </section>
          
          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">Feedback</h2>
            <p>
              Agradecemos seu feedback sobre a acessibilidade do HiperVerso. Por favor, nos informe se encontrar barreiras de acessibilidade:
            </p>
            <ul className="list-none space-y-1 mt-2">
              <li>
                <strong>E-mail:</strong>{' '}
                <ContactEmail
                  channel="accessibility"
                  className="text-primary hover:underline"
                  fallback="canal em configuração; será divulgado em breve."
                />
              </li>
            </ul>
             <p className="mt-2">
              Tentamos responder ao feedback dentro de 5 dias úteis.
            </p>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
