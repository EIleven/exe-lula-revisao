# Dívida técnica: baseline medido e critérios

Medido em 2026-10-15 na branch `feat/lula-producao` (HEAD `8ea788b`, já sem as cópias mortas de `src/`), com Node 22. Nada
aqui foi "resolvido em massa" de propósito: a tolerância do build a erros de tipos e de lint **foi mantida**
(`typescript.ignoreBuildErrors` e `eslint.ignoreDuringBuilds` em `next.config.ts`) até haver critérios objetivos (seção 2).

## 1. Estado medido

| Verificação | Resultado |
|---|---|
| `npm run typecheck` | **205 erros em 68 arquivos**, 0 globais (eram 227 antes de remover as cópias mortas, que tinham 22). 203 em `src/*`, 2 em configs (`next-pwa` sem tipos; `request.ip` no middleware). Um `next build`/`next dev` gera `.next/types` e soma cerca de 10 erros (TS2344: props de página do Next 15). |
| `npm run lint` | **713 erros e 24 avisos em 155 arquivos** (eram 726 antes da remoção, que tinha 13) |
| `npm run build` | Passa, porque a tolerância acima o esconde |
| Functions (`lint` e `build`) | 0 erros |

Para reproduzir: `npm run typecheck`, `npm run lint`, `npm --prefix functions run lint`.

**Typecheck por código:** TS2322 ×75, TS2345 ×29, TS2769 ×25, TS18048 ×22 ("possivelmente undefined"), TS2339 ×20, TS7006 ×17,
TS7016 ×8 (7 por falta de `@types/uuid`), TS2353 ×8. **Por área:** `src/components` 122, `src/lib` 39, `src/app` 35,
`src/hooks` 7, `src/ai` 1.

**Lint por regra:** `no-unused-vars` ×498, `no-explicit-any` ×204, `react/no-unescaped-entities` ×19 (14 em `terms`),
`prefer-const` ×4, `no-empty-object-type` ×1; avisos: `react-hooks/exhaustive-deps` ×16, `no-img-element` ×7, `alt-text` ×1.
Os 6 erros de `react-hooks/rules-of-hooks` foram corrigidos (commit `1579319`).

**Pontos quentes (lint):** `CreatePostDialogContent.tsx` 53, `userService.ts` 27, `QuoteCommentDialogContent.tsx` 22,
`postReadService.ts` 21, `CommentInputArea.tsx` (`comments/` 20 e `feed/` 16).

## 2. Critérios propostos para remover a tolerância (aguardam aprovação)

1. **Catraca:** um passo de verificação falha se o typecheck passar de 205 erros ou o lint passar de 713 erros (a dívida
   só pode diminuir).
2. **Erros que indicam bug primeiro:** TS2339 e TS18048 nos fluxos críticos (post, comentário, mensagens, autenticação) e
   qualquer erro `react-hooks/*` (hoje 0 em `rules-of-hooks`).
3. **Desligar cada flag só quando a checagem estiver verde:** `ignoreBuildErrors` quando `npm run typecheck` retornar 0
   em `src/`; `ignoreDuringBuilds` quando `npm run lint` retornar 0
   erros (ou as regras ruidosas forem rebaixadas por configuração documentada). Critério objetivo: 3 builds seguidos com a
   checagem ligada e sem erro.

## 3. Achados funcionais (por prioridade)

**Alta: segurança e privacidade** (medidas pela suíte de fluxos; causa, plano e o que já foi corrigido em
`docs/matriz-funcionalidades.md`)

- **S1.** `users` é listável sem login e o documento mistura dados públicos e privados: e-mail e data de nascimento de todos
  saem numa consulta, inclusive de perfil "privado". Plano: dividir o perfil (público em `users/{uid}`; privado em
  `users/{uid}/private/...`). **Bloqueia a abertura.**
- **S2.** `posts` é listável sem filtro de visibilidade: posts privados e "só seguidores" vazam em consultas. Plano: regra de
  `list` com `visibility == 'public'` e consultas do app com esse filtro.
- **S3.** Anexos de mensagens e arquivos pessoais seguem legíveis por quem conhece o endereço exato (a listagem pública foi
  fechada em `5662c87`). Plano: caminho próprio com regra por participante.
- **S4.** Contadores gravados pelo cliente (`followersCount`, `views`, `analytics`, `reposts`, `commentsCount`...) são forjáveis
  por qualquer usuário logado. Plano: mover para Functions, como já é com curtidas.
- **S5.** `access_events` aceita criação anônima e o limite de `/api/log-access` usa um IP que o cliente informa;
  `/api/extract-article` não exige login; `/guests` do RTDB é público para escrita. Veja a tabela da matriz.

**Alta: funcional**

1. ~~PWA não funciona~~ **Resolvido** (`6e58ce8`, `7edccf2`, `5ed57c4`; veja `docs/pwa.md`). Causas: `/_offline` e
   `app-build-manifest.json` respondiam 404 no pré-cache (derrubam a instalação do service worker), nada registrava o
   `/sw.js`, o manifest ia para o `<body>` (Chrome: `no-manifest`) e o cache padrão do `next-pwa` guardava dados do
   Firestore/Storage e HTML de rotas privadas. **Pendente:** os ícones do manifest (`/icons/*.png`) respondem 404, único erro
   de instalação restante (etapa da logo).
2. **Presença no Firestore é negada pelas regras.** `src/lib/services/presenceService.ts:48` faz `updateDoc` de
   `isOnline` e `lastSeen` em `users/{uid}`; a regra de `update` (`firestore.rules`, linha 149) não permite esses campos e
   a promessa não tem `.catch`, então cada conexão gera um erro de página. O ponto verde das conversas e o contador de
   usuários ativos do painel admin dependem desse campo e nunca têm dado. Auditoria e proposta (RTDB como fonte única,
   sem liberar campos no Firestore) em `docs/presenca.md`; também medidos: sair da conta deixa o usuário online para sempre,
   duas abas se anulam e `/guests` é público para leitura e escrita. Aguarda decisão.
3. **Push web.** `firebase-messaging-sw.js` nunca existiu no histórico do Git, e a Function usa `sendToDevice`, API
   legada do FCM descontinuada (usar `sendEachForMulticast`). O ícone do push (`/favicon-192x192.png`) também não existe.
4. **Sem cabeçalhos de segurança** (CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy), medido nas
   respostas. Relevante também para o WebView do app Android.

**Média**

5. `request.ip` não existe mais no Next 15 (`src/middleware.ts:14`): o IP de convidados cai no fallback quando faltam
   `x-forwarded-for` e `x-real-ip`.
6. Next 15: `params` e `headers()` síncronos geram avisos em desenvolvimento (e 10 erros TS2344 de props de página).
7. Assets inexistentes (404): `/favicon-16x16.png`, `/favicon-32x32.png`, `/profile.png`, `/apple-touch-icon.png`,
   `/favicon-192x192.png` e os `/icons/*` do manifest. A etapa da logo resolve.
8. `<html>` sem atributo `lang` (o layout raiz não conhece o idioma).
9. O emulador do Firestore **não valida índices compostos**: revisar `firestore.indexes.json` contra as consultas antes
   de publicar. Já identificados sem índice: as três consultas de `searchPosts` (`visibility` + `isDeleted` + `createdAt`;
   o mesmo com `likes` antes; e com `category`), pois os índices existentes só cobrem consultas com `hashtags`.
   Confirmar no Firestore real do projeto novo.

**Baixa**

10. Componentes duplicados entre `comments/` e `feed/` (`CommentInputArea`, `CommentActionsBar`, `CommentThread`,
    `PaginatedCommentList`). A cópia `feed/ReplyDialogContent.tsx`, que ninguém importava, foi removida (`8ea788b`).
11. Cópias mortas herdadas do Firebase Studio: `src/index.ts`, `src/next.config.ts`, `src/next-sitemap.config.js` e
    `feed/ReplyDialogContent.tsx` já foram removidas (`8ea788b`, com a prova de que nada as usava). Restam
    `src/firestore.rules` e `src/ads.txt`, que **não** estavam na aprovação e seguem no repositório até nova autorização.
12. `firebase-functions` desatualizado (aviso do emulador); `next-pwa` sem tipos; `uuid` sem `@types/uuid`.
13. `npm ci` acusa 14 pacotes depreciados; `npm audit` não foi executado.
14. O wrapper do Gradle em `android/` foi atualizado fora desta sessão para 9.7.1 enquanto o plugin do Android é o 8.7.2:
    conferir a compatibilidade antes de gerar o APK.
15. `firestore.rules` (regra de `update` de `users`): `diff.affectedKeys().has('name')` usa uma função que não existe
    (aviso `Invalid function name: has` ao carregar as regras); só funciona porque o outro lado do `||` é verdadeiro.
    Trocar por `'name' in diff.affectedKeys()`.
16. Funcionalidades prometidas e ainda não prontas: tela `/files` ("em construção"), perfil privado sem fluxo de aprovar
    seguidores (quem não segue vê "User Not Found" em inglês) e a presença (veja `docs/presenca.md`).

## 4. Resolvido neste ciclo

`npm run typecheck` voltou a verificar o código (`40ccb17`); hooks condicionais (`1579319`); `robots.txt` estático que
encobria o dinâmico (`6da0417`); ping de sitemap morto e `SITE_URL` nas Functions (`2b35f52`); arquivos gerados
versionados (`832e326`); mensagem de boas-vindas e contatos (`4f4e088`, `eabcdb8`); cópias mortas de `src/` (`8ea788b`);
PWA: instala, registra, offline, manifest no `<head>` e cache restrito (`6e58ce8`, `7edccf2`, `5ed57c4`).
Segurança e funcional, medidos pela suíte de fluxos: escalada de privilégio no cadastro (`4365159`), comentário alheio
editável (`a074a44`), listas de conversas e notificações (`9cc2aed`), conversa de terceiros e preferência de DM
(`5a011cc`), conversa sem última mensagem/não lidas, callable pública, preferências e bloqueios sem efeito e nova
conversa para a pessoa errada (`38e3a8b`, `d7b16ae`), SSRF (`ff88685`), contador de curtidas (`b8a166d`), mídia de post
apagado (`7e42fd2`), listagem pública do Storage (`5662c87`) e e-mails de exemplo na política (`9fe0621`).
