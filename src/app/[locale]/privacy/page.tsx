// src/app/[locale]/privacy/page.tsx
// Política de Privacidade. O conteúdo sai da matriz de tratamentos (docs/matriz-de-tratamentos.md) e dos prazos de
// docs/politica-de-retencao.md — não se escreve aqui nada que não esteja lá. Ao mudar um prazo ou um tratamento,
// mude a matriz primeiro e traga para cá; o contrário produz política que o sistema não cumpre.
'use client';

import Link from 'next/link';
import { useLocale } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import BackButton from '@/components/shared/BackButton';
import ContactEmail from '@/components/shared/ContactEmail';
import PrivacyPreferencesButton from '@/components/consent/PrivacyPreferencesButton';
import { siteConfig } from '@/config/site';
import { DATA_REQUEST_DEADLINE_DAYS } from '@/lib/rights/dataRequest';
import { MARKER_TTL_DAYS } from '@/lib/analytics/markerExpiry';

export default function PrivacyPolicyPage() {
  const locale = useLocale();
  const controlador = siteConfig.controller.name;

  return (
    <div className="container mx-auto max-w-3xl py-8">
      <BackButton />
      <Card className="shadow-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold">Política de Privacidade</CardTitle>
          <CardDescription>Versão 2 &middot; em vigor desde 11 de novembro de 2026</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 text-foreground/90 prose prose-invert prose-p:text-foreground/90 prose-a:text-primary prose-li:text-foreground/90">
          <p>
            Esta política explica, sem rodeio, que dados a rede <strong>HiperVerso</strong> (anteriormente Exe. Lula) coleta, para quê, com que fundamento legal,
            por quanto tempo, com quem compartilha e o que você pode exigir. Ela é escrita para ser lida por quem usa
            a rede, não por advogado.
          </p>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">1. Quem trata seus dados</h2>
            <p>
              O <strong>controlador</strong> é <strong>{controlador}</strong>, {siteConfig.controller.nature},
              responsável pela plataforma. Ele também exerce a função de <strong>encarregado</strong> pelo tratamento
              de dados pessoais. Contato:{' '}
              <ContactEmail channel="privacy" className="text-primary hover:underline" fallback={null} />.
            </p>
            <p>
              A rede é operada por uma só pessoa. Isso significa que quem responde aos seus pedidos é a mesma pessoa
              que decide sobre moderação. Está dito aqui de propósito: se você não concordar com uma resposta, pode
              reclamar à <strong>Autoridade Nacional de Proteção de Dados (ANPD)</strong>, que é independente desta
              plataforma.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">2. O que coletamos</h2>

            <h3 className="text-lg font-semibold mt-4 mb-1">Obrigatório para ter conta</h3>
            <ul>
              <li><strong>E-mail</strong> — identifica a conta e permite recuperar o acesso.</li>
              <li><strong>Senha</strong> — guardada <em>cifrada</em> pelo serviço de autenticação; nem nós a vemos.</li>
              <li><strong>Nome e nome de usuário</strong> — como você aparece na rede.</li>
            </ul>

            <h3 className="text-lg font-semibold mt-4 mb-1">Opcional, você escolhe dar</h3>
            <ul>
              <li>Data de nascimento, biografia, localização, site, foto de perfil e capa.</li>
            </ul>
            <p>
              <strong>Seu e-mail e sua data de nascimento não ficam no perfil público.</strong> Eles moram num
              documento separado que <strong>só você lê</strong> — nem outras pessoas, nem quem não tem conta.
            </p>

            <h3 className="text-lg font-semibold mt-4 mb-1">O que você publica</h3>
            <ul>
              <li>Posts, artigos, comentários, enquetes, mídia, mensagens diretas e arquivos.</li>
            </ul>

            <h3 className="text-lg font-semibold mt-4 mb-1">Técnico, coletado automaticamente</h3>
            <ul>
              <li>
                <strong>Contagem de acessos:</strong> o caminho da página (sem os parâmetros do endereço), se você
                estava logado ou visitando, a <strong>região aproximada</strong> (país, estado, cidade) e a hora. A
                região é deduzida do seu IP e <strong>o IP é descartado em seguida</strong>. Esse registro não guarda
                IP, navegador, sistema operacional, identificador de sessão nem vínculo com a sua conta, e não
                rastreia de onde você veio nem para onde foi.
              </li>
              <li>
                <strong>Registros do servidor:</strong> a infraestrutura que hospeda a rede registra dados de conexão,
                inclusive endereço IP, para operar o serviço e conter abuso. É um registro separado, de acesso
                restrito.
              </li>
              <li>
                <strong>Métricas de publicação:</strong> o autor de um post vê <strong>visualizações estimadas</strong>.
                Para não contar a mesma pessoa repetidamente, guardamos um marcador por pessoa, apagado
                automaticamente em <strong>{MARKER_TTL_DAYS} dias</strong>. Repetições são evitadas{' '}
                <em>dentro dessa janela</em>: depois dela a mesma pessoa pode ser contada de novo, e por isso o número
                é estimativa. <strong>O autor nunca vê quem viu, só a quantidade.</strong>
              </li>
              <li>
                <strong>Presença:</strong> se você está on-line e quando foi visto por último.
              </li>
            </ul>

            <h3 className="text-lg font-semibold mt-4 mb-1">Inferido (deduzido, não informado por você)</h3>
            <ul>
              <li>Sugestões de perfis para seguir, calculadas a partir de quem você segue e com quem interage.</li>
              <li>A região aproximada descrita acima.</li>
            </ul>
            <p>
              <strong>Não coletamos CPF, RG, telefone, dados bancários nem biometria.</strong> A rede não cobra nada e
              não pede documento.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">3. Para quê, e com que base legal</h2>
            <p>
              A LGPD exige um fundamento para cada tratamento. Os nossos:
            </p>
            <div className="not-prose overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-2 pr-3 font-semibold">Para quê</th>
                    <th className="py-2 pr-3 font-semibold">Fundamento</th>
                  </tr>
                </thead>
                <tbody className="align-top">
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-3">Criar e manter sua conta; publicar, comentar, seguir, enviar mensagens</td>
                    <td className="py-2 pr-3">Execução do serviço que você pediu (art. 7º, V)</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-3">Conter fraude, abuso e automação; proteger as contas</td>
                    <td className="py-2 pr-3">Legítimo interesse (art. 7º, IX)</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-3">Contagem de acessos e métricas de publicação</td>
                    <td className="py-2 pr-3">Legítimo interesse (art. 7º, IX)</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-3">Moderação e análise de denúncias</td>
                    <td className="py-2 pr-3">Legítimo interesse e obrigação legal (art. 7º, IX e II)</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-3">Medição de uso por ferramentas do Google</td>
                    <td className="py-2 pr-3"><strong>Consentimento</strong> (art. 7º, I) — desligado até você aceitar</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-3">Publicar seu conteúdo no Bluesky</td>
                    <td className="py-2 pr-3"><strong>Consentimento</strong> (art. 7º, I) — só se você conectar a conta</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-3">Guardar registros de acesso</td>
                    <td className="py-2 pr-3">Obrigação legal, quando aplicável, e legítimo interesse</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-sm">
              Onde invocamos legítimo interesse, a lei exige que o nosso interesse não se imponha aos seus direitos.
              Esse exame está documentado internamente e <strong>ainda será revisado por advogado</strong>: não
              afirmamos que a análise está concluída.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">4. Por quanto tempo guardamos</h2>
            <div className="not-prose overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-2 pr-3 font-semibold">O quê</th>
                    <th className="py-2 pr-3 font-semibold">Prazo</th>
                  </tr>
                </thead>
                <tbody className="align-top">
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-3">Conta e conteúdo</td>
                    <td className="py-2 pr-3">Enquanto a conta existir, ou até você apagar</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-3">Depois de excluir a conta</td>
                    <td className="py-2 pr-3">Acesso bloqueado e perfil fora do ar <strong>na hora</strong>; remoção dos sistemas ativos em até <strong>30 dias</strong></td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-3">Registros de acesso e logs operacionais</td>
                    <td className="py-2 pr-3"><strong>180 dias</strong></td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-3">Marcador de quem viu uma publicação</td>
                    <td className="py-2 pr-3"><strong>{MARKER_TTL_DAYS} dias</strong></td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-3">Incidente de segurança confirmado</td>
                    <td className="py-2 pr-3">Pelo menos <strong>5 anos</strong>, com acesso restrito</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-3">Dados mínimos para comprovar pedido ou cumprir dever legal</td>
                    <td className="py-2 pr-3">Até <strong>5 anos</strong>, com finalidade específica</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-3">Backups</td>
                    <td className="py-2 pr-3">Ciclo de até <strong>90 dias</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              <strong>Sobre backups, com honestidade:</strong> dado excluído pode continuar existindo, de forma
              residual, em cópias de segurança inacessíveis ao uso normal, até serem sobrescritas pelo ciclo. Nós não
              restauramos dado excluído para uso normal, e se um backup for recuperado, os pedidos de exclusão são
              reaplicados antes de o sistema voltar.
            </p>
            <p>
              Prazo maior só acontece com obrigação legal, ordem judicial, pedido válido de preservação, investigação
              de incidente ou necessidade concreta de exercer direitos — e cada exceção é registrada com motivo,
              alcance, responsável e data de encerramento.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">5. Com quem compartilhamos</h2>
            <p>
              <strong>Não vendemos, não alugamos e não trocamos seus dados pessoais</strong>, nem os entregamos a
              terceiros para fins comerciais deles. Quem está envolvido na operação:
            </p>
            <ul>
              <li>
                <strong>Google (Firebase):</strong> autenticação, banco de dados, armazenamento de arquivos, funções
                de servidor e proteção contra abuso. Atua como <em>operador</em>, seguindo nossas instruções. O banco
                de dados fica na região de São Paulo, mas o Google é empresa estrangeira — o que configura{' '}
                <strong>transferência internacional de dados</strong>.
              </li>
              <li>
                <strong>Google Tag Manager e Google Analytics:</strong> medição de uso, <strong>somente com o seu
                aceite</strong>. Sem ele, o script não é nem baixado.
              </li>
              <li>
                <strong>Bluesky (AT Protocol):</strong> somente se você conectar sua conta e pedir a publicação. O que
                sai para lá <strong>deixa de estar sob nosso controle</strong> e passa a seguir as regras daquela rede.
              </li>
            </ul>
            <p>
              Hoje a rede <strong>não exibe anúncios</strong>. Se isso mudar, publicidade dependerá do seu aceite.
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
              O que isso <strong>não</strong> significa: não entregamos a conta inteira quando registros específicos
              bastam, não divulgamos publicamente dados de quem é investigado, e não tratamos violação de regra
              interna como se fosse crime.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">7. Seus direitos, e como exercer</h2>
            <p>Você pode pedir: confirmação de que tratamos seus dados, acesso, correção, exclusão, portabilidade, informação sobre com quem compartilhamos, revogação de consentimento e oposição a tratamento baseado em legítimo interesse.</p>
            <p><strong>Três coisas você faz sozinho, agora, sem pedir nada a ninguém:</strong></p>
            <ul>
              <li><strong>Exportar seus dados</strong> em arquivo estruturado — Configurações &rsaquo; Conta.</li>
              <li><strong>Excluir sua conta</strong> — Configurações &rsaquo; Conta.</li>
              <li><strong>Mudar ou revogar o consentimento de cookies</strong> — aqui mesmo:</li>
            </ul>
            <div className="not-prose my-3">
              <PrivacyPreferencesButton variant="outline" />
            </div>
            <p>
              Para o resto, use o <strong>canal de atendimento ao titular</strong>, que gera um{' '}
              <strong>protocolo</strong> e deixa você acompanhar o andamento:{' '}
              <Link href={`/${locale}/settings/data-rights`} className="text-primary hover:underline">
                abrir um pedido
              </Link>
              . Se preferir, ou se você não tem conta (ou perdeu o acesso a ela), escreva para{' '}
              <ContactEmail channel="privacy" className="text-primary hover:underline" fallback={null} />.
            </p>
            <p>
              <strong>Prazo:</strong> respondemos em até <strong>{DATA_REQUEST_DEADLINE_DAYS} dias</strong>. Não
              cobramos nada.
            </p>
            <p>
              <strong>Como confirmamos que o pedido é seu — e o que não fazemos:</strong> para pedidos sobre a sua
              conta, basta você estar <strong>logado</strong> nela; para os que apagam ou mudam dados de forma
              sensível, pedimos sua senha de novo no momento da ação. Nada além disso.{' '}
              <strong>Não pedimos CPF, documento, selfie nem qualquer prova de identidade civil</strong> — e,
              justamente por isso, não afirmamos verificar quem você é na vida real. O que verificamos é controle da
              conta e do e-mail, que é o proporcional ao risco.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">8. Consentimento</h2>
            <p>
              O que depende de consentimento está <strong>desligado por padrão</strong> e só liga se você aceitar:
              medição de uso, publicidade (hoje inexistente) e publicação fora da plataforma. Você pode{' '}
              <strong>revogar quando quiser</strong>, pelo mesmo caminho em que aceitou, e revogar é tão fácil quanto
              aceitar. Guardamos a versão do aviso e a data da sua decisão, para poder demonstrar que ela existiu.
            </p>
            <p>
              Se o aviso mudar, a decisão antiga deixa de valer e perguntamos de novo — consentimento dado para outro
              texto não cobre tratamento novo.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">9. Segurança</h2>
            <p>Entre as medidas em uso:</p>
            <ul>
              <li>dados pessoais fora do perfil público, em documento que só o titular lê;</li>
              <li>regras de banco que impedem leitura e escrita indevidas, com testes automatizados que as exercitam;</li>
              <li>proteção contra automação e abuso na entrada da rede;</li>
              <li>higienização do conteúdo publicado, para impedir código malicioso em artigos;</li>
              <li>contadores gravados apenas pelo servidor, nunca pelo navegador;</li>
              <li>segredos guardados em cofre, fora do código e fora do navegador.</li>
            </ul>
            <p>
              <strong>Sobre mensagens diretas, com honestidade:</strong> elas são protegidas no transporte e por
              regras de acesso, mas <strong>não têm criptografia ponta a ponta</strong>. Tecnicamente, o controlador
              tem acesso ao conteúdo. Não as use para o que você não contaria a quem administra a rede.
            </p>
            <p>
              Nenhuma medida é perfeita. Não declaramos que a plataforma é inviolável, nem que está integralmente
              adequada à LGPD: a adequação é um trabalho em curso e esta política é parte dele.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">10. Incidentes</h2>
            <p>
              Se houver incidente de segurança que possa trazer risco ou dano relevante a você, comunicaremos a ANPD e
              você, nos prazos e na forma da lei, dizendo o que aconteceu, quais dados foram afetados, o que estamos
              fazendo e o que você pode fazer. Incidentes confirmados ficam registrados por pelo menos 5 anos, com
              acesso restrito.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">11. Crianças e adolescentes</h2>
            <p>
              A rede é destinada a maiores de 18 anos. Sabemos que declarar isso não elimina obrigação: uma rede social
              é provavelmente acessível a adolescentes, e por isso tratamos o tema com o melhor interesse da criança e
              do adolescente em primeiro lugar.
            </p>
            <ul>
              <li><strong>Não</strong> usamos dados de menores para publicidade comportamental — não há publicidade na rede.</li>
              <li><strong>Não</strong> construímos perfil comportamental de menores.</li>
              <li>Crime contra criança e adolescente tem tratamento prioritário nas{' '}
                <Link href={`/${locale}/community-guidelines`} className="text-primary hover:underline">
                  Diretrizes da Comunidade
                </Link>, com preservação de prova e comunicação à autoridade competente.
              </li>
              <li>
                Se você é responsável por um menor e identificar uma conta dele aqui, escreva para o canal de
                privacidade e trataremos com prioridade.
              </li>
            </ul>
            <p className="text-sm">
              Qual mecanismo de aferição de idade é <em>proporcional</em> — sem obrigar todos a entregar documento, o
              que criaria um risco de dado pessoal maior do que resolve — é ponto que depende de parecer jurídico e
              ainda não está decidido. Preferimos dizer isso a fingir que está resolvido.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">12. O que você publica é público</h2>
            <p>
              Conteúdo que você publica em perfil público pode ser visto, copiado, citado e indexado por mecanismos de
              busca. <strong>Apagar aqui não desfaz cópia que outra pessoa já fez.</strong> Perfil privado restringe
              quem vê, mas não impede quem já viu de ter guardado.
            </p>
            <p>
              Se um dia a rede passar a se conectar a outras redes (federação), isso será{' '}
              <strong>opcional e desligado por padrão</strong>, por publicação e por conta. É importante saber desde
              já: conteúdo enviado a outra rede é copiado para servidores que não controlamos, e pedido de exclusão
              propagado é feito em <strong>melhor esforço</strong> — não há garantia de apagamento em terceiros.
            </p>
            <p>
              Ao publicar algo sobre outra pessoa, você também está tratando dados dela. Dado pessoal de terceiro
              divulgado para expor, intimidar ou facilitar ataque é proibido.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">13. Inteligência artificial</h2>
            <p>
              <strong>A rede não usa inteligência artificial.</strong> Nenhum conteúdo seu é enviado a serviço de IA de
              terceiros, por motivo nenhum, e <strong>seus dados não alimentam treinamento de modelo algum</strong>.
              Se isso algum dia mudar, dependerá de consentimento específico, destacado e revogável — nunca de
              autorização genérica escondida num texto como este.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">14. Alterações</h2>
            <p>
              Mudança relevante é anunciada na própria rede antes de valer. O histórico fica abaixo, para você poder
              comparar.
            </p>
            <ul>
              <li><strong>Versão 2 — 11 de novembro de 2026:</strong> reescrita completa. Identificação do controlador e do encarregado; bases legais por tratamento; prazos de retenção; transferência internacional declarada; direitos e canal de atendimento com prazo; distinção entre autenticar conta e verificar identidade civil; honestidade sobre mensagens diretas sem criptografia ponta a ponta, sobre resíduo em backup e sobre limites da exclusão em cópias de terceiros; vedação ao uso de dados para IA.</li>
              <li><strong>Versão 1 — 17 de outubro de 2023:</strong> primeira versão, baseada em modelo genérico. Continha afirmações incorretas (não mencionava operadores nem transferência internacional, falava em transações e faturas que não existem, e descrevia coleta de dados técnicos maior do que a real).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-6 mb-2">15. Contato</h2>
            <p>
              {controlador} —{' '}
              <ContactEmail channel="privacy" className="text-primary hover:underline" fallback={null} />. Você também
              pode reclamar à ANPD.
            </p>
            <p className="text-sm">
              Documentos relacionados:{' '}
              <Link href={`/${locale}/cookies`} className="text-primary hover:underline">Política de Cookies</Link>,{' '}
              <Link href={`/${locale}/terms`} className="text-primary hover:underline">Termos de Serviço</Link> e{' '}
              <Link href={`/${locale}/community-guidelines`} className="text-primary hover:underline">Diretrizes da Comunidade</Link>.
            </p>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
