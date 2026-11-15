# Domínio oficial: https://exercitodolula.app

## Decisão

- O endereço oficial do SOBERAN é **https://exercitodolula.app**. `https://www.exercitodolula.app` redireciona (308)
  para ele.
- `soberan.app` **não é mais usado nem controlado** pelo projeto. O APK antigo (v1.0.0) abre esse domínio num WebView e
  não deve ser distribuído nem apresentado como seguro.

## Fonte única

Tudo parte de `src/config/site.ts` (`siteConfig`): `baseUrl`, `officialOrigin`, `officialHost`, `wwwHost`, `contact` e
`apkDownloadEnabled`. Nenhum outro arquivo repete a URL.

| Consumidor | Como usa |
|---|---|
| Open Graph, canonical, JSON-LD, sitemap, robots, links de compartilhar | `siteConfig.baseUrl` |
| `next.config.ts` | `redirects()` do `www` para o domínio principal |
| `capacitor.config.ts` | `server.url` e `allowNavigation` (host exato, sem curinga) |
| Cloud Functions | `SITE_URL` (`functions/.env*`), com padrão igual ao oficial |

`npm run check:domain` falha se o domínio antigo reaparecer em arquivo rastreado e se o padrão das Functions divergir de
`site.ts`. As referências ao domínio antigo que restam são só históricas (histórico do Git, `docs/`, `docs/archive/`); as
cópias mortas herdadas do Firebase Studio que ainda o citavam foram removidas.

## Variáveis de ambiente

| Variável | Onde | Para quê |
|---|---|---|
| `NEXT_PUBLIC_BASE_URL` | web | Opcional; sobrescreve a origem **apenas em desenvolvimento** (`http://localhost:9002`) |
| `SITE_URL` | Functions | Base do `/api/revalidate` e do link do push (padrão: domínio oficial) |
| `REVALIDATE_SECRET` | web **e** Functions | Mesmo valor nos dois lados (revalidação on-demand) |
| ~~`NEXT_PUBLIC_CONTACT_EMAILS_ENABLED`~~ | — | **Removida em 2026-11-11**: o contato é fixo em `OWNER_CONTACT_EMAIL` (`src/config/site.ts`) |
| `NEXT_PUBLIC_APK_DOWNLOAD_ENABLED` | web | `true` só com APK novo, assinado e validado |
| `CAP_DEV_URL` | Capacitor | Só desenvolvimento (`http://10.0.2.2:9002`); recusa qualquer host que não seja local |

## Redirecionamento `www`

`next.config.ts` redireciona `www.exercitodolula.app` por **Host** apenas: o destino é a constante oficial e
`x-forwarded-host` é ignorado, então cabeçalhos forjados pelo cliente não causam redirecionamento nem open redirect
(testado). É a rede de segurança: o redirecionamento principal também deve ser configurado no provedor de hospedagem.

## `.app` exige HTTPS (HSTS pré-carregado)

O TLD `.app` está na lista de HSTS pré-carregado dos navegadores: o domínio inteiro (apex, `www` e qualquer subdomínio) só
abre por HTTPS e o navegador **recusa** certificado ausente, expirado ou que não cubra o nome, sem a opção de "continuar assim
mesmo". Consequências para a publicação:

- o certificado precisa cobrir `exercitodolula.app` **e** `www.exercitodolula.app` antes de o DNS apontar para a hospedagem
  (o `www` também precisa de TLS válido só para poder redirecionar);
- o navegador nem tenta `http://`: não conte com o redirecionamento 80 → 443 para o uso normal (mantenha-o para ferramentas
  e rastreadores);
- o app Android (WebView) segue a mesma regra: `server.url` é `https://exercitodolula.app` e `cleartext` só em
  desenvolvimento (`capacitor.config.ts`).

## O que depende de configuração externa

- **DNS e certificado** (apex e `www`): valores fornecidos pelo provedor de hospedagem; mudança de DNS só com aprovação.
- **Firebase Auth** (projeto novo): domínios autorizados `exercitodolula.app` e `www.exercitodolula.app`, cliente OAuth do
  Google e modelos de e-mail.
- **E-mail de contato**: criar `suporte@`, `privacidade@` e `acessibilidade@` (MX, SPF, DKIM e DMARC no DNS) e só então
  trocar `OWNER_CONTACT_EMAIL` em `src/config/site.ts`, hoje `admlabra@gmail.com` (canal real, decidido em
  2026-11-11, mas fora do domínio). A política de privacidade precisa de um canal de contato real. Serviço ainda
  não escolhido: veja `docs/email-dominio.md`.
- **Google Search Console**: nova propriedade e sitemap. O token em `metadata.verification.google`
  (`src/app/[locale]/layout.tsx`) pertence à propriedade antiga.
- **AdSense e Google Tag Manager**: o layout e o `ads.txt` usam IDs das contas do site antigo; o novo domínio precisa ser
  aprovado no AdSense ou os IDs trocados.
- **APK novo**: antes de gerar, rode `npx cap sync android`. O arquivo gerado e ignorado pelo Git
  `android/app/src/main/assets/capacitor.config.json` **ainda contém a URL antiga**; sem o sync, um APK montado no Android
  Studio abriria o domínio errado. Assine com a keystore do projeto (conferir que é a mesma do APK antigo, sem expor senhas)
  e só publique depois de validar o site no domínio definitivo.
