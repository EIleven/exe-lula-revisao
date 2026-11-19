import React from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldCheck, Lock, Globe2, Code2, Sparkles } from 'lucide-react';

export const metadata = {
  title: 'Manifesto pela Soberania Digital no Brasil | HiperVerso',
  description:
    'Manifesto de Breno César pela soberania digital no Brasil, software livre, federação aberta e privacidade verificável no HiperVerso.',
};

function BrazilianFlagMajestic() {
  return (
    <figure className="my-6 flex flex-col items-center">
      <div className="relative overflow-hidden rounded-xl border border-border/70 shadow-lg ring-1 ring-emerald-500/20 bg-black/5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/bandeira-brasil-mastro.jpg"
          alt="Bandeira Nacional do Brasil hasteada no mastro a céu aberto na Praça dos Três Poderes, Brasília"
          className="h-auto w-full max-w-md max-h-[420px] object-contain block"
        />
      </div>
      <figcaption className="mt-2.5 text-xs font-medium tracking-wide text-muted-foreground">
        Bandeira do Brasil no mastro a céu aberto · Soberania Digital · Software Livre
      </figcaption>
    </figure>
  );
}

export default async function ManifestoPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <Link
          href={`/${locale}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar para o HiperVerso
        </Link>
      </div>

      <article className="rounded-2xl border border-border bg-card p-6 sm:p-10 shadow-sm">
        <header className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-500 mb-4">
            <Sparkles className="h-3.5 w-3.5" />
            Manifesto Institucional
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
            Manifesto pela Soberania Digital no Brasil
          </h1>

          <BrazilianFlagMajestic />

          <p className="text-sm font-semibold text-foreground">
            Por Breno César · Criador do HiperVerso
          </p>
        </header>

        <div className="mt-8 space-y-6 text-[15px] leading-7 text-foreground/90">
          <p>
            No Fediverso, milhares de pessoas já estão colocando em prática uma ideia simples e
            poderosa: a internet volta a ser nossa quando construímos espaços abertos, transparentes
            e feitos para conversar de verdade.
          </p>

          <p>
            O <strong>HiperVerso</strong> nasce dessa mesma vontade de agir, com os pés no chão e
            muito trabalho pela frente, construindo a partir do Brasil uma rede social federada,
            segura e aberta para quem cria, debate, pesquisa e participa da vida pública.
          </p>

          <section className="rounded-xl border border-border/70 bg-muted/20 p-5 space-y-2">
            <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
              <ShieldCheck className="h-5 w-5 text-primary" />
              1. Respeito ao seu tempo: cronologia limpa e transparente
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Quem escolhe o Fediverso valoriza saber exatamente o que está vendo e por quê. No{' '}
              <strong className="text-foreground">HiperVerso</strong>, o feed segue a ordem
              cronológica real das publicações, citações e reposts de quem você acompanha, com
              separação clara entre a rede local, seus seguidos, seus feeds personalizados e o
              Fediverso aberto. O controle do que você lê fica nas suas mãos.
            </p>
          </section>

          <section className="rounded-xl border border-border/70 bg-muted/20 p-5 space-y-3">
            <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
              <Lock className="h-5 w-5 text-emerald-500" />
              2. Privacidade construída no código: P2P Zero DB e E2EE
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              A comunidade aberta sempre sonhou com mensagens diretas que não dependessem da
              confiança cega em um servidor. Levamos esse desafio a sério na prática:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-sm leading-6 text-muted-foreground">
              <li>
                <strong className="text-foreground">Modo P2P Zero DB</strong>: conexão direta entre
                navegadores via WebRTC, sem gravar mensagens no banco de dados do servidor.
              </li>
              <li>
                <strong className="text-foreground">
                  Criptografia de ponta a ponta no aparelho (ECDH P-256 + AES-GCM-256)
                </strong>
                : protegendo textos, imagens, vídeos e arquivos enviados nas conversas privadas.
              </li>
              <li>
                <strong className="text-foreground">
                  Pareamento direto e chaves soberanas entre seus dispositivos
                </strong>
                : você sincroniza sua identidade criptográfica e suas chaves de acesso diretamente
                entre seus próprios aparelhos, valida via QR Code e pode revogar acessos quando
                quiser, mantendo suas chaves sempre com você.
              </li>
            </ul>
          </section>

          <section className="rounded-xl border border-border/70 bg-muted/20 p-5 space-y-2">
            <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
              <Globe2 className="h-5 w-5 text-sky-500" />
              3. Pontes abertas: ActivityPub e Bluesky conversando juntos
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Acreditamos que protocolos abertos servem para aproximar pessoas, não para dividir
              comunidades. Por isso o <strong className="text-foreground">HiperVerso</strong> fala
              ActivityPub de forma nativa e integra pontes com o Bluesky (ATProto), permitindo que
              artistas, jornalistas, desenvolvedores e amigos dialoguem entre redes diferentes com
              clareza sobre a origem e o alcance de cada publicação.
            </p>
          </section>

          <section className="rounded-xl border border-border/70 bg-muted/20 p-5 space-y-3">
            <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
              <Code2 className="h-5 w-5 text-amber-500" />
              4. Software Livre e colaboração brasileira na prática
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Soberania digital se constrói passo a passo, compartilhando conhecimento e formando
              comunidade. Venho dedicando meu trabalho junto à comunidade de software livre e
              desenvolvimento aberto no Brasil com a convicção de que temos talento e capacidade
              para criar nossa própria infraestrutura tecnológica:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-sm leading-6 text-muted-foreground">
              <li>
                Adotamos padrões abertos de federação e criptografia auditável, fortalecendo um
                ecossistema em que ninguém fica preso a um único lugar.
              </li>
              <li>
                Mantemos canais estruturados para que colaboradores, revisores e desenvolvedores
                brasileiros estudem o sistema, enviem melhorias e evoluam o projeto conosco com
                responsabilidade e respeito ao trabalho coletivo.
              </li>
            </ul>
          </section>

          <section className="pt-2 space-y-3">
            <h2 className="text-lg font-bold text-foreground">
              5. Um passo concreto, feito com coragem
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Não temos a pretensão de ter todas as respostas prontas, mas temos disposição para
              construir todos os dias:
            </p>
            <ol className="list-decimal pl-5 space-y-1.5 text-sm leading-6 text-muted-foreground">
              <li>
                <strong className="text-foreground">Tecnologia brasileira e aberta</strong>,
                conectada ao mundo pelo Fediverso.
              </li>
              <li>
                <strong className="text-foreground">Privacidade verificável por criptografia</strong>
                , pensada para proteger as pessoas.
              </li>
              <li>
                <strong className="text-foreground">Autonomia para a nossa comunidade</strong>, para
                que a conversa pública brasileira floresça em terreno próprio.
              </li>
            </ol>
          </section>

          <footer className="border-t border-border pt-6 text-center space-y-1">
            <p className="text-sm text-muted-foreground">
              Seguimos construindo, aprendendo e abrindo caminhos juntos.
            </p>
            <p className="text-base font-bold text-foreground">
              Pela soberania digital do Brasil. 🇧🇷🦑
            </p>
          </footer>
        </div>
      </article>
    </main>
  );
}

