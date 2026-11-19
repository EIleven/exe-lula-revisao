// src/config/site.ts
// FONTE ÚNICA do endereço público do SOBERAN. Nenhum outro arquivo deve repetir URLs do domínio:
// importe siteConfig (o `npm run check:domain` falha se o domínio antigo reaparecer no código).

/** Domínio oficial (decisão do projeto). O www e os aliases redirecionam para ele (ver next.config.ts). */
const OFFICIAL_ORIGIN = 'https://hiperverso.app';
const OFFICIAL_HOST = new URL(OFFICIAL_ORIGIN).host;

/**
 * Canal do titular. Decisão do responsável pela plataforma em 2026-11-11: UM endereço real concentra suporte,
 * privacidade e acessibilidade até a rede crescer. Não é do domínio — as caixas `@exercitodolula.app` ainda não
 * existem (ver docs/email-dominio.md) — mas é um canal que EXISTE, e é isso que o art. 41 da LGPD cobra. Anunciar
 * `privacidade@exercitodolula.app` sem ninguém do outro lado não cumpria nada; dizer "o canal está sendo
 * configurado", como a política fazia em produção, cumpria menos ainda.
 */
const OWNER_CONTACT_EMAIL = 'admlabra@gmail.com';

/**
 * Identificação do controlador. O titular precisa saber QUEM trata seus dados (LGPD, art. 9º, I e III) e ter o
 * contato do encarregado divulgado publicamente (art. 41, § 1º). Decisão de 2026-11-11: pessoa física, o próprio
 * responsável, acumulando controlador e encarregado enquanto a rede é pequena — e os documentos precisam DIZER que
 * acumula, com o caminho da ANPD, porque quem responde aos pedidos é a mesma pessoa que decide a moderação.
 *
 * Fonte única: nenhuma página repete o nome. Se um dia virar pessoa jurídica, troca-se aqui.
 */
const CONTROLLER = {
  name: 'Breno César',
  nature: 'pessoa física',
  /** Hoje a mesma pessoa é controlador e encarregado (DPO). */
  actsAsDpo: true,
} as const;

/**
 * Origem usada para montar links absolutos (Open Graph, canonical, sitemap, compartilhamentos).
 * NEXT_PUBLIC_BASE_URL só deve sobrescrever em desenvolvimento local (ex.: http://localhost:9002).
 */
function resolveBaseUrl(override: string | undefined): string {
  const raw = override?.trim();
  if (!raw) return OFFICIAL_ORIGIN;
  try {
    return new URL(raw).origin; // normaliza: sem barra final e sem caminho
  } catch {
    throw new Error(`NEXT_PUBLIC_BASE_URL inválida: "${raw}"`);
  }
}

export const siteConfig = {
  name: "HiperVerso",
  description: "Conectando vozes com soberania digital, democracia de dados e moderação comunitária.",
  baseUrl: resolveBaseUrl(process.env.NEXT_PUBLIC_BASE_URL),
  /** Origem oficial, independente de variáveis de ambiente (redirecionamentos e app Android). */
  officialOrigin: OFFICIAL_ORIGIN,
  officialHost: OFFICIAL_HOST,
  wwwHost: `www.${OFFICIAL_HOST}`,
  /** Host canônico dos endereços ActivityPub (@usuario@hiperverso.social). */
  federationHost: 'hiperverso.social',
  federationOrigin: 'https://hiperverso.social',
  /**
   * Hosts em que esta instância JÁ TEVE identidade no Fediverso. Os seguidores remotos conhecem as contas por estes
   * endereços, e servidores de fora voltam a eles para reconferir a conta. Enquanto estiverem aqui:
   *
   * - o ator continua a ser servido por eles, com o `id` DELES (um documento que declara `id` de outro host é
   *   recusado como falsificação — pelo Mastodon e pelo nosso próprio `validateFetchedActor`);
   * - esse ator leva `movedTo` apontando para o canônico, que é como o Fediverso diz "esta conta se mudou";
   * - o WebFinger deles volta a responder, senão ninguém consegue nem reencontrar a conta antiga;
   * - o ator canônico declara `alsoKnownAs` apontando de volta (veja MIGRACAO_ATIVA).
   *
   * Tirar um host daqui faz quem seguia por ele perder a conta de vista. Só sai depois que o `Move` for aceito e o
   * número de seguidores no endereço antigo chegar a zero.
   */
  legacyFederationHosts: ['exercitodolula.app', 'www.exercitodolula.app'] as const,
  /**
   * Janela de migração aberta. Enquanto `true`, o ator canônico declara `alsoKnownAs` com os atores dos hosts antigos
   * — é a prova que o Mastodon exige para aceitar o `Move` (o destino tem de reconhecer a origem).
   *
   * Isto NÃO é a lista de contas externas que a pessoa digitava (removida em 2026-11-17 por expor um mapa de
   * identidades cruzadas): aqui é UM endereço, gerado pelo servidor, da MESMA conta no NOSSO domínio anterior, e só
   * enquanto a mudança está em curso. Depois que todos migrarem, vira `false` e o campo some do ator.
   */
  migrationAliasEnabled: true,
  aliasHosts: ['hiperverso.social', 'www.hiperverso.social', 'exercitodolula.app', 'www.exercitodolula.app', 'www.hiperverso.app'] as const,
  appStoreHosts: ['hiperverso.app', 'www.hiperverso.app'] as const,
  /**
   * Domínio das URLs públicas de mídia. Aponta para o MESMO backend do App Hosting que o apex (conferido por DNS:
   * media, www e apex resolvem para o mesmo IP), então não há infraestrutura separada — quem serve é a rota /m/[id].
   * Ver docs/arquitetura-midia.md.
   */
  mediaHost: `media.${OFFICIAL_HOST}`,
  mediaOrigin: `https://media.${OFFICIAL_HOST}`,
  mediaOrigins: [
    `https://media.${OFFICIAL_HOST}`,
    'https://media.hiperverso.social',
    'https://media.exercitodolula.app',
  ] as const,
  controller: CONTROLLER,
  contact: {
    // Sem interruptor de ambiente: o canal do titular é obrigatório e passou a existir (ver OWNER_CONTACT_EMAIL).
    // Deixar isso atrás de uma variável permitia subir produção sem canal nenhum — foi o que aconteceu.
    enabled: true,
    support: OWNER_CONTACT_EMAIL,
    privacy: OWNER_CONTACT_EMAIL,
    accessibility: OWNER_CONTACT_EMAIL,
  },
  // Distribuição do APK: desligada até existir um APK novo, assinado e validado no domínio definitivo
  // (o APK antigo aponta para um domínio que não controlamos). Ligar com NEXT_PUBLIC_APK_DOWNLOAD_ENABLED=true.
  apkDownloadEnabled: process.env.NEXT_PUBLIC_APK_DOWNLOAD_ENABLED === 'true',
  // A rede NÃO exibe anúncios. Não há bandeira para ligar, nem componente para chamar: o código de publicidade
  // foi removido em 2026-11-19, por decisão de produto. Deixar a estrutura "desligada" era uma promessa mais
  // fraca do que não ter o código -- e, numa rede que se apresenta como soberana, a diferença importa.
  // Telemetria externa do Google (GTM / Google Analytics) DESLIGADA por soberania de dados:
  // nenhum evento de navegação é enviado para servidores de medição ou anúncios do Google.
  googleTelemetryEnabled: false,
};
