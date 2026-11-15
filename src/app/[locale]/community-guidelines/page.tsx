// src/app/[locale]/community-guidelines/page.tsx
// Diretrizes da Comunidade. Os Termos citavam "diretrizes da comunidade" e o documento não existia — esta página
// fecha essa referência. O texto de trabalho, com as pendências jurídicas, está em docs/diretrizes-da-comunidade.md.
//
// Regra de redação, decidida em 2026-11-11: separar sempre o que é PROIBIDO POR LEI do que é LÍCITO MAS SENSÍVEL e
// do que é ESCOLHA DA PLATAFORMA. Não atribuir à LGPD proibição que ela não impõe — ela trata de dados pessoais e
// não é lei de conteúdo.
'use client';

import Link from 'next/link';
import { useLocale } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import BackButton from '@/components/shared/BackButton';
import ContactEmail from '@/components/shared/ContactEmail';

export default function CommunityGuidelinesPage() {
  const locale = useLocale();

  return (
    <div className="container mx-auto max-w-3xl py-8">
      <BackButton />
      <Card className="shadow-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold">Diretrizes da Comunidade</CardTitle>
          <CardDescription>Versão 1 &middot; em vigor desde 11 de novembro de 2026</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 text-foreground/90 prose prose-invert prose-p:text-foreground/90 prose-a:text-primary prose-li:text-foreground/90">
          <p>
            Esta é uma rede de debate político. Discussão dura, crítica a autoridade, denúncia e humor ofensivo{' '}
            <strong>são permitidos</strong> — é disso que uma rede política é feita. O que não é permitido está abaixo,
            e separado com honestidade: uma coisa é a lei proibir, outra é a plataforma escolher não hospedar.
          </p>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">Como ler estas diretrizes</h2>
            <ul>
              <li><strong>1. Conteúdo ilegal</strong> — o que a lei brasileira proíbe. <strong>Proibido.</strong></li>
              <li><strong>2. Lícito, mas sensível</strong> — não é crime, mas pode ferir quem não escolheu ver. <strong>Permitido com cuidado</strong>: aviso ou controle de visibilidade.</li>
              <li><strong>3. Escolha da plataforma</strong> — <strong>não é exigência legal</strong>, é decisão de produto. Dita como escolha, para quem discordar saber do que discorda.</li>
            </ul>
            <p className="text-sm">
              Uma observação que evita confusão comum: a <strong>LGPD</strong> trata de dados pessoais e{' '}
              <strong>não é lei de conteúdo</strong>. Ela não proíbe opinião, crítica, debate político, humor nem
              conteúdo adulto. As obrigações sobre crianças e adolescentes vêm do ECA e do ECA Digital; as de crime, do
              Código Penal. Nenhuma regra desta página se justifica com &ldquo;a LGPD exige&rdquo; quando a exigência
              vem de outro lugar.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">1. Conteúdo ilegal — proibido</h2>

            <h3 className="text-lg font-semibold mt-4 mb-1">Crianças e adolescentes: tolerância zero</h3>
            <p>Terminantemente proibido, sem exceção de contexto, ironia, &ldquo;denúncia&rdquo; ou valor artístico:</p>
            <ul>
              <li>material de abuso sexual infantil — <strong>real, manipulado ou simulado</strong>;</li>
              <li>nudez ou sexualização de criança e adolescente;</li>
              <li>exploração sexual, aliciamento, sextorsão;</li>
              <li>solicitação ou interação sexual envolvendo menores;</li>
              <li>tráfico, sequestro ou aproximação para exploração;</li>
              <li>produzir, oferecer, pedir, armazenar, divulgar ou compartilhar esse material;</li>
              <li>links, instruções ou mecanismos para localizar ou distribuir esse conteúdo.</li>
            </ul>
            <p>
              Havendo detecção ou indício fundado, o conteúdo sai do ar <strong>imediatamente</strong>, a conta é{' '}
              <strong>suspensa preventivamente</strong>, as evidências são preservadas com acesso restrito e trilha
              auditável, e o caso é comunicado à autoridade competente. Confirmada violação grave, o banimento é
              permanente. Quem modera não baixa, copia nem recircula o material além do estritamente necessário.
            </p>

            <h3 className="text-lg font-semibold mt-4 mb-1">Outros conteúdos ilegais</h3>
            <ul>
              <li>conteúdo íntimo divulgado <strong>sem consentimento</strong>, inclusive <em>deepfake</em> sexual;</li>
              <li>sextorsão, extorsão, conteúdo obtido por coerção;</li>
              <li>exposição íntima ou sexual de terceiro sem consentimento;</li>
              <li>qualquer conteúdo sexual envolvendo pessoa cuja <strong>idade adulta não possa ser confirmada</strong>;</li>
              <li>incitação a crime, ameaça, terrorismo;</li>
              <li>racismo, injúria racial e demais discriminações criminalizadas;</li>
              <li>fraude, golpe, <em>phishing</em>, programa malicioso;</li>
              <li>violação de direito autoral;</li>
              <li><strong>doxxing</strong>: divulgar dado pessoal de alguém para expor, intimidar ou facilitar ataque.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">2. Lícito, mas sensível — permitido com cuidado</h2>
            <p>
              Aqui não há proibição; há ferramenta, porque quem não escolheu ver também tem direito. Violência real,
              acidente e morte, relato de automutilação ou suicídio (<strong>incentivo é outra coisa, e não é
              permitido</strong>), nudez não sexual em arte, amamentação, protesto ou saúde, conteúdo médico e
              forense: tudo permitido, com aviso quando o contexto pedir.
            </p>
            <p>
              <strong>A resposta preferencial a conteúdo lícito e incômodo é dar controle a quem vê, não apagar.</strong>{' '}
              Você tem, nas configurações: visibilidade por publicação, perfil privado, palavras silenciadas,
              silenciar e bloquear contas, preferência de quem pode te mandar mensagem e controle de exibição de
              conteúdo sensível.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">3. Escolha da plataforma</h2>
            <p className="text-sm">
              <strong>Esta seção não vem da lei.</strong> É decisão do responsável pela plataforma.
            </p>
            <h3 className="text-lg font-semibold mt-4 mb-1">Sem pornografia nem conteúdo sexual explícito</h3>
            <p>
              A rede <strong>opta</strong> por não permitir pornografia ou conteúdo sexual explícito,{' '}
              <strong>mesmo produzido consensualmente por adultos</strong>. Isso é lícito no Brasil; a rede escolhe não
              hospedar. Medidas, em escala: remoção, advertência, limitação temporária, suspensão e, em caso grave ou
              reincidente, banimento.
            </p>
            <p>
              <strong>Importante:</strong> conteúdo sexual adulto consensual <strong>não</strong> é comunicado à
              polícia por violar regra da plataforma. Violar regra interna não é crime. A comunicação à autoridade
              acontece só nas hipóteses da seção seguinte.
            </p>
            <h3 className="text-lg font-semibold mt-4 mb-1">Sem inteligência artificial</h3>
            <p>
              A rede não usa IA. Conteúdo sintético apresentado como real é tratado como engano, não como tecnologia.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">4. Quando falamos com autoridades</h2>
            <p>
              Quando houver indícios fundados de crime, risco concreto à vida ou à integridade de alguém, ou obrigação
              legal, a Plataforma poderá preservar evidências e comunicar o fato às autoridades competentes. Dados
              pessoais, registros de acesso e conteúdos serão compartilhados <strong>somente na extensão
              necessária</strong>, conforme a legislação aplicável, requisição juridicamente válida ou ordem judicial,
              quando exigida.
            </p>
            <p>O que isso não é, e não será:</p>
            <ul>
              <li>não entregamos a conta inteira quando registros específicos bastam;</li>
              <li>não divulgamos publicamente dados de quem é investigado;</li>
              <li>não presumimos culpa antes da apuração;</li>
              <li>não permitimos doxxing, exposição ou justiça pelas próprias mãos;</li>
              <li>preservamos o sigilo de quem denuncia e das vítimas.</li>
            </ul>
            <p>
              Toda comunicação a autoridade é registrada: fundamento, quem solicitou, o que foi fornecido e quem
              decidiu.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">5. Denúncia</h2>
            <p>
              Há uma categoria de <strong>prioridade máxima</strong>: segurança de criança ou adolescente. A denúncia
              não expõe publicamente quem denuncia nem a vítima, aceita endereço e informação sem recircular material
              ilegal, e vai para análise humana com registro das providências.
            </p>
            <p>
              <strong>Denúncia não é veto automático</strong>: ela abre análise. Denúncia em massa, coordenada ou de
              má-fé para silenciar alguém é, ela mesma, violação — e custa peso, limitação do canal e, na
              reincidência, sanção.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">6. Medidas e recurso</h2>
            <p>
              Escala proporcional: aviso, remoção do conteúdo, limitação temporária, suspensão, banimento. Quem for
              sancionado <strong>é informado do motivo e pode recorrer</strong>.
            </p>
            <p>
              As únicas exceções a informar o motivo: quando isso comprometer investigação, expuser vítima, facilitar
              destruição de prova, ou contrariar obrigação legal ou determinação de autoridade.
            </p>
            <p>
              <strong>Transparência devida:</strong> a rede é operada por uma pessoa só, que modera e também julga o
              recurso. Em questão de dados pessoais, você pode recorrer à <strong>ANPD</strong>, independente desta
              plataforma.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">7. Contato</h2>
            <p>
              Dúvidas sobre estas diretrizes:{' '}
              <ContactEmail channel="support" className="text-primary hover:underline" fallback={null} />. Questões de
              dados pessoais têm canal próprio, com protocolo e prazo:{' '}
              <Link href={`/${locale}/settings/data-rights`} className="text-primary hover:underline">
                atendimento ao titular
              </Link>
              .
            </p>
            <p className="text-sm">
              Veja também os{' '}
              <Link href={`/${locale}/terms`} className="text-primary hover:underline">Termos de Serviço</Link> e a{' '}
              <Link href={`/${locale}/privacy`} className="text-primary hover:underline">Política de Privacidade</Link>.
            </p>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
