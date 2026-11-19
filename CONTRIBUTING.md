# Guia de Contribuição e Estrutura de PRs (`CONTRIBUTING.md`)

Este repositório (`hiperverso`) recebe análises técnicas, diagnósticos e correções (*fixes*) de forma organizada, rastreável e documentada.

> **Importante:** Antes de contribuir, leia [`LICENSE`](./LICENSE) e [`ACORDO_REVISAO.md`](./ACORDO_REVISAO.md). Ao enviar contribuições (*Pull Requests* ou patches), você concorda que elas sejam licenciadas sob a mesma **GNU AGPL-3.0** deste projeto.

---

## 1. Fluxo Recomendado

1. **Identifique o problema ou melhoria:**
   - Para bugs: abra uma Issue usando o template **Bug Report**.
   - Para análise de segurança, privacidade ou arquitetura: abra uma Issue usando **Audit Finding**.
2. **Crie uma branch dedicada:**
   Nunca envie commits diretos na `main`. Use o padrão:
   - `fix/<modulo>-<resumo-curto>` (ex.: `fix/p2p-group-reconnect`)
   - `audit/<modulo>-<resumo-curto>` (ex.: `audit/rtdb-rules-review`)
   - `perf/<modulo>-<resumo-curto>` (ex.: `perf/feed-listeners`)
   - `docs/<resumo-curto>` (ex.: `docs/p2p-architecture`)
3. **Mantenha o escopo limpo e objetivo:**
   - Um PR por problema/correção.
   - Evite alterar arquivos fora do escopo do fix.
   - Nunca inclua credenciais, tokens, `.env`, arquivos de log ou dados de produção.
4. **Valide localmente antes de abrir o PR:**
   ```bash
   npm run typecheck
   npm run lint
   ```
5. **Abra o Pull Request** preenchendo todos os campos do template padrão (`.github/PULL_REQUEST_TEMPLATE.md`).

---

## 2. Padrão de Commits

Utilize mensagens claras no formato Conventional Commits:

- `fix(p2p): corrige reconexão de peer em grupo`
- `fix(fediverse): valida assinatura HTTP em inbox`
- `perf(feed): reduz leituras redundantes em PostCard`
- `docs(readme): documenta fluxo de emuladores`

---

## 3. Revisão e Integração

## Licença e Revisão

Todas as contribuições enviadas para este repositório são regidas pela licença **GNU Affero General Public License v3.0 (`AGPL-3.0`)** descrita em [`LICENSE`](./LICENSE).

