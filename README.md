# Exe. Lula (HiperVerso) — Repositório de Revisão Técnica (`exe-lula-revisao`)

> **CÓDIGO PROPRIETÁRIO (SOURCE-AVAILABLE) — NÃO É CÓDIGO ABERTO**  
> Este repositório contém uma versão sanitizada do sistema **Exe. Lula** (`HiperVerso`) disponibilizada para análise técnica, auditoria e envio de correções via Pull Request sob os termos estritos da [`LICENSE`](./LICENSE) e do [`ACORDO_REVISAO_JUAN.md`](./ACORDO_REVISAO_JUAN.md).  
> O repositório principal de produção permanece estritamente privado.  
> Leia obrigatoriamente [`LICENSE`](./LICENSE) e [`ACORDO_REVISAO_JUAN.md`](./ACORDO_REVISAO_JUAN.md) antes de prosseguir.

---

## Visão Geral da Arquitetura

O sistema combina uma rede social federada (ActivityPub / Fediverso) com mensageria direta e em grupo com suporte a **WebRTC P2P (Modo Zero DB)**, criptografia ponta a ponta (**E2EE**) e sincronização entre dispositivos do próprio usuário.

### Stack Principal

- **Frontend / SSR / API Routes:** Next.js (App Router), React, TypeScript, Tailwind CSS, `next-intl`
- **Persistência & Tempo Real:** Firebase Firestore, Firebase Realtime Database (sinalização WebRTC P2P e sincronização de dispositivos), Firebase Storage, Firebase Auth
- **Federação:** ActivityPub (`WebFinger`, `Actor`, `Inbox`, `Outbox`, `Follow`, `HTTP Signatures`) + Cloud Functions (`functions/src`)
- **Mensageria P2P & Criptografia:** WebRTC `RTCDataChannel`, E2EE (`src/lib/crypto/*`), fila cronológica offline-first (`queued` / `sent`) e sincronização entre dispositivos logados

---

## Mapa de Diretórios e Módulos

```text
src/
├── app/
│   ├── [locale]/              # Páginas localizadas (feed, explorar, mensagens DM/grupo, perfis, admin, políticas)
│   └── api/                   # Rotas de API (ActivityPub, ICE/TURN, uploads, previews, OAuth federado)
├── components/
│   ├── feed/                  # PostCard, contadores em tempo real, timelines
│   ├── layout/                # Navegação, DesktopSidebar, RightSidebar (3ª coluna + rodapé institucional)
│   └── messages/              # MessageBubble (P2P / P2P · Na fila / DB), P2pNoticeBanner, input de mídia
├── lib/
│   ├── activitypub/           # Materialização remota, assinatura HTTP (RFC/Cavage) e federação
│   ├── crypto/                # Primitivas E2EE, keyring e identidade
│   ├── media/                 # Política de vídeo e pipeline de processamento
│   ├── p2p/                   # Motor WebRTC P2P (DM e Grupo), fila local, preferências, sync entre dispositivos
│   ├── security/              # Defesa SSRF (`safe-fetch.ts`) e higienização HTML/XSS (`sanitizeHtml.ts`)
│   ├── server/                # Serviços server-side (Auth, OAuth Bluesky/Fediverso, federação)
│   └── services/              # Serviços de domínio (posts, usuários, conversas, notificações)
video-worker/                  # Worker containerizado (Cloud Run Job + FFmpeg) para transcodificação de vídeo
functions/                     # Firebase Cloud Functions (federação assíncrona, triggers de contadores)
e2e/                           # Suítes determinísticas de verificação por módulo (`*-check.mjs`)
firestore.rules                # Regras de segurança do Firestore
database.rules.json            # Regras de segurança do RTDB (sinalização P2P DM/Grupo e sync de dispositivos)
storage.rules                  # Regras de segurança do Cloud Storage
```

---

## Configuração Local (Sem Credenciais de Produção)

Este repositório **não inclui** segredos, chaves de serviço ou variáveis de produção.

1. Copie o arquivo de exemplo:
   ```bash
   cp .env.example .env.local
   ```
2. Instale as dependências:
   ```bash
   npm install
   ```
3. Verifique tipos e lint:
   ```bash
   npm run typecheck
   npm run lint
   ```
4. Rode verificações determinísticas por módulo (offline, sem credenciais Firebase):
   ```bash
   node e2e/ap-core-check.mjs
   node e2e/ap-services-check.mjs
   node e2e/e2ee-check.mjs
   node e2e/p2p-core-check.mjs
   node e2e/safe-fetch-check.mjs
   node e2e/xss-render-check.mjs
   node e2e/video-pipeline-check.mjs
   ```
5. Rode em ambiente local (preferencialmente com Firebase Emulators):
   ```bash
   npm run dev
   ```

---

## Como Revisar e Enviar Fixes / PRs

Consulte [`CONTRIBUTING.md`](./CONTRIBUTING.md) para padrões de branch, commits e abertura de Pull Requests estruturados utilizando os templates em `.github/`.

---

## Licença e Propriedade

Copyright (c) 2026 Breno César — Todos os direitos reservados.  
Uso, análise e contribuição estritamente regulados por [`LICENSE`](./LICENSE) e [`ACORDO_REVISAO_JUAN.md`](./ACORDO_REVISAO_JUAN.md).
