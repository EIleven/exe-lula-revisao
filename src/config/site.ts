// src/config/site.ts
// FONTE ÚNICA do endereço público do SOBERAN. Nenhum outro arquivo deve repetir URLs do domínio:
// importe siteConfig (o `npm run check:domain` falha se o domínio antigo reaparecer no código).

/** Domínio oficial (decisão do projeto). O www redireciona para ele (ver next.config.ts). */
const OFFICIAL_ORIGIN = 'https://exercitodolula.app';
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
  name: "Exe. Lula",
  description: "Conectando vozes com soberania digital, democracia de dados e moderação comunitária.",
  baseUrl: resolveBaseUrl(process.env.NEXT_PUBLIC_BASE_URL),
  /** Origem oficial, independente de variáveis de ambiente (redirecionamentos e app Android). */
  officialOrigin: OFFICIAL_ORIGIN,
  officialHost: OFFICIAL_HOST,
  wwwHost: `www.${OFFICIAL_HOST}`,
  /**
   * Domínio das URLs públicas de mídia. Aponta para o MESMO backend do App Hosting que o apex (conferido por DNS:
   * media, www e apex resolvem para o mesmo IP), então não há infraestrutura separada — quem serve é a rota /m/[id].
   * Ver docs/arquitetura-midia.md.
   */
  mediaHost: `media.${OFFICIAL_HOST}`,
  mediaOrigin: `https://media.${OFFICIAL_HOST}`,
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
  // Publicidade DESLIGADA por decisão de produto (2026-10-24): a rede não mostra anúncios por enquanto. A estrutura
  // (AdClientComponent, AdPostCard, espaços na página do post e no feed) fica inteira no código para voltar a ser
  // testada e melhorada depois — nada de anúncio é carregado, nenhum espaço vazio aparece e o script do AdSense nem é
  // baixado. Ligar com NEXT_PUBLIC_ADS_ENABLED=true.
  adsEnabled: process.env.NEXT_PUBLIC_ADS_ENABLED === 'true',
};
