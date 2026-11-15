# Exe. Lula / Echo — Repositório Privado de Revisão e Contribuição (`echo-review`)

> **ACESSO RESTRITO E CONFIDENCIAL — NÃO É CÓDIGO ABERTO**  
> Este repositório contém uma versão sanitizada do sistema **Exe. Lula / Echo** disponibilizada exclusivamente sob acordo privado para análise técnica, auditoria e envio de correções via Pull Request por revisores convidados (incluindo **Juan / `@MrJc01`**).  
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

## Mapa de Diretórios

```text
src/
├── app/
│   ├── [locale]/              # Páginas localizadas (feed, explorar, mensagens DM/grupo, perfis, admin, políticas)
│   └── api/                   # Rotas de API (ActivityPub, ICE/TURN, uploads, etc.)
├── components/
│   ├── feed/                  # PostCard, contadores em tempo real, timelines
│   ├── layout/                # Navegação, DesktopSidebar, RightSidebar (3ª coluna + rodapé institucional)
│   └── messages/              # MessageBubble (P2P / P2P · Na fila / DB), P2pNoticeBanner, input de mídia
├── lib/
│   ├── crypto/                # Primitivas E2EE, keyring e identidade
│   ├── p2p/                   # Motor WebRTC P2P (DM e Grupo), fila local, preferências, sync entre dispositivos
│   ├── activitypub/           # Materialização remota, assinatura HTTP e federação
│   └── services/              # Serviços de domínio (posts, usuários, conversas, notificações)
functions/                     # Firebase Cloud Functions (federação assíncrona, triggers)
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
4. Rode em ambiente local (preferencialmente com Firebase Emulators):
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
