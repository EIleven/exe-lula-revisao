// src/app/[locale]/terms/page.tsx
// Termos de Serviço. Reescritos em 2026-11-11: a versão anterior era modelo genérico traduzido, prometia rescisão
// "sem aviso prévio, por qualquer motivo" (contrário à decisão de dar motivo e recurso) e citava diretrizes da
// comunidade que não existiam.
'use client';

import Link from 'next/link';
import { useLocale } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import BackButton from '@/components/shared/BackButton';
import ContactEmail from '@/components/shared/ContactEmail';
import { siteConfig } from '@/config/site';

export default function TermsOfServicePage() {
  const locale = useLocale();
  const operador = siteConfig.controller.name;

  return (
    <div className="container mx-auto max-w-3xl py-8">
      <BackButton />
      <Card className="shadow-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold">Termos de Serviço</CardTitle>
          <CardDescription>Versão 2 &middot; em vigor desde 11 de novembro de 2026</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 text-foreground/90 prose prose-invert prose-p:text-foreground/90 prose-a:text-primary prose-li:text-foreground/90">
          <p>
            Estes Termos regem o uso da plataforma <strong>Exe. Lula</strong> (o &ldquo;Serviço&rdquo;), operada por{' '}
            <strong>{operador}</strong>, {siteConfig.controller.nature}. Usando o Serviço, você concorda com eles. Se
            discordar de alguma parte, não use a rede.
          </p>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">1. Quem pode usar</h2>
            <p>
              O Serviço é destinado a pessoas com <strong>18 anos ou mais</strong>. Não cobramos nada para usar e não
              pedimos documento, CPF ou cartão.
            </p>
            <p className="text-sm">
              Sejamos honestos sobre o alcance disso: declarar &ldquo;18+&rdquo; não é o mesmo que verificar idade, e
              não afirmamos verificar. Qual mecanismo de aferição seria proporcional — sem obrigar todos a entregar
              documento, o que criaria risco maior do que resolve — é questão aberta, tratada nas{' '}
              <Link href={`/${locale}/community-guidelines`} className="text-primary hover:underline">
                Diretrizes da Comunidade
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">2. Sua conta</h2>
            <p>
              Forneça informações corretas e mantenha-as atualizadas. Você é responsável por proteger sua senha e
              pelo que acontece na sua conta. Avise o quanto antes se suspeitar de acesso indevido.
            </p>
            <p>
              Você pode <strong>exportar seus dados</strong> e <strong>excluir sua conta</strong> quando quiser, em
              Configurações &rsaquo; Conta, sem precisar pedir autorização a ninguém.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">3. O que você publica</h2>
            <p>
              <strong>O conteúdo é seu.</strong> Você mantém todos os direitos sobre o que escreve, fotografa e envia.
              Para a rede poder funcionar, você nos autoriza a <strong>hospedar, exibir, armazenar e distribuir</strong>{' '}
              esse conteúdo dentro da plataforma, conforme a visibilidade que <em>você</em> escolher — e apenas para
              operar o Serviço. Não vendemos seu conteúdo, não o licenciamos a terceiros e não o usamos para treinar
              sistema algum.
            </p>
            <p>
              Essa autorização termina quando você apaga o conteúdo ou a conta. Mas há limites técnicos reais, e é
              melhor você saber deles: <strong>cópia que outra pessoa já fez não desaparece</strong>, conteúdo público
              pode ter sido indexado por mecanismos de busca, e dado excluído pode permanecer de forma residual em
              backups até a sobrescrita do ciclo.
            </p>
            <p>
              Você é responsável pelo que publica, inclusive pela legalidade. Ao publicar algo sobre outra pessoa, você
              também está tratando dados dela.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">4. Regras de conduta</h2>
            <p>
              O que é permitido e o que não é está nas{' '}
              <Link href={`/${locale}/community-guidelines`} className="text-primary hover:underline">
                Diretrizes da Comunidade
              </Link>
              , que fazem parte destes Termos. Elas separam o que a lei proíbe, o que é lícito mas sensível e o que a
              plataforma escolhe não hospedar — e essa separação é intencional.
            </p>
            <p>
              Resumo do que não se faz aqui: crime contra criança e adolescente (tolerância zero), conteúdo íntimo sem
              consentimento, incitação a crime, discriminação criminalizada, fraude, doxxing e — por escolha da
              plataforma, não por exigência legal — pornografia e conteúdo sexual explícito.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">5. Moderação, suspensão e recurso</h2>
            <p>
              Podemos remover conteúdo, limitar alcance ou funções, suspender ou encerrar conta que viole estes Termos
              ou as Diretrizes. Quando isso acontecer, <strong>você será informado do motivo e poderá recorrer</strong>.
            </p>
            <p>
              Deixaremos de informar o motivo apenas quando isso comprometer investigação, expuser vítima, facilitar
              destruição de provas ou contrariar obrigação legal ou determinação de autoridade.
            </p>
            <p>
              Em casos graves — especialmente os que envolvem crianças e adolescentes — a conta pode ser suspensa
              preventivamente antes da análise, e o conteúdo retirado do ar de imediato.
            </p>
            <p className="text-sm">
              A rede é operada por uma pessoa só, que modera e também julga o recurso. Isso está dito de propósito.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">6. Autoridades</h2>
            <p>
              Quando houver indícios fundados de crime, risco concreto à vida ou à integridade de alguém, ou obrigação
              legal, a Plataforma poderá preservar evidências e comunicar o fato às autoridades competentes. Dados
              pessoais, registros de acesso e conteúdos serão compartilhados <strong>somente na extensão
              necessária</strong>, conforme a legislação aplicável, requisição juridicamente válida ou ordem judicial,
              quando exigida.
            </p>
            <p>
              Não entregamos a conta inteira quando registros específicos bastam, e violar regra interna não é crime:
              quebra de regra da plataforma não vira comunicação à polícia.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">7. Seus dados</h2>
            <p>
              O tratamento de dados pessoais é descrito na{' '}
              <Link href={`/${locale}/privacy`} className="text-primary hover:underline">
                Política de Privacidade
              </Link>
              , com as bases legais, os prazos de retenção e seus direitos. Para exercer um direito com protocolo e
              prazo, use o{' '}
              <Link href={`/${locale}/settings/data-rights`} className="text-primary hover:underline">
                atendimento ao titular
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">8. Conexão com outras redes</h2>
            <p>
              A rede pode, no futuro, se conectar a outras redes sociais abertas. Isso será{' '}
              <strong>opcional e desligado por padrão</strong>, escolhido por você, por conta e por publicação.
            </p>
            <p>
              Conteúdo enviado a outra rede é copiado para servidores que não controlamos. Pedido de exclusão
              propagado é feito em <strong>melhor esforço</strong>: não prometemos apagamento em terceiros, porque não
              temos como cumprir. Hoje, a única integração desse tipo é a publicação opcional no Bluesky, que só
              funciona se você conectar sua conta.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">9. Sem inteligência artificial</h2>
            <p>
              A rede não usa IA. Seu conteúdo não é enviado a serviço de IA de terceiros e seus dados não alimentam
              treinamento de modelo algum. Mudar isso dependeria de consentimento específico, destacado e revogável.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">10. O Serviço é oferecido como está</h2>
            <p>
              Fazemos o possível para manter a rede no ar, segura e funcionando, mas não garantimos funcionamento
              ininterrupto nem ausência de falhas. O Serviço é gratuito e mantido por uma pessoa.
            </p>
            <p>
              Não respondemos pelo conteúdo que outras pessoas publicam. Nada aqui afasta direitos que a lei brasileira
              lhe garante de forma irrenunciável.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">11. Alterações</h2>
            <p>
              Podemos alterar estes Termos. Mudança relevante é anunciada na rede <strong>antes</strong> de entrar em
              vigor, e o histórico fica abaixo. Continuar usando depois da vigência significa aceitar a nova versão; se
              não aceitar, você pode exportar seus dados e encerrar a conta.
            </p>
            <ul>
              <li>
                <strong>Versão 2 — 11 de novembro de 2026:</strong> reescrita completa. Identificação de quem opera;
                licença de conteúdo explicitada e limitada à operação do Serviço; motivo e direito de recurso em lugar
                da rescisão &ldquo;sem aviso prévio, por qualquer motivo&rdquo;; cláusula de autoridades; Diretrizes da
                Comunidade criadas e incorporadas; federação futura como opcional; vedação de uso para IA; limites
                reais de exclusão declarados.
              </li>
              <li>
                <strong>Versão 1 — 17 de outubro de 2023:</strong> modelo genérico. Citava diretrizes da comunidade
                inexistentes e permitia encerrar conta sem aviso nem motivo.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">12. Lei aplicável</h2>
            <p>
              Aplica-se a <strong>lei brasileira</strong>. Antes de qualquer disputa, fale com a gente: a maior parte
              das questões se resolve por e-mail.
            </p>
            <p className="text-sm">
              Eleição de foro e cláusulas de solução de conflito não foram definidas nesta versão — dependem de
              orientação jurídica, especialmente por envolver relação de consumo. Preferimos a ausência à cláusula
              inválida.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">13. Contato</h2>
            <p>
              {operador} — <ContactEmail channel="support" className="text-primary hover:underline" fallback={null} />.
            </p>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
