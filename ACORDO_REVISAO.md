# Termo de Acordo, Uso Restrito e Licença Source-Available de Revisão Técnica

**Projeto:** Exe. Lula / HiperVerso (`exe-lula-revisao`)  
**Proprietário / Titular:** Breno César (`@Breno`) — Contato: `brenobarros11@hotmail.com`  
**Público Aplicável:** Usuários, revisores, auditores e colaboradores com acesso via GitHub  
**Última Atualização:** 16 de novembro de 2026

---

## 1. Objeto do Acordo

Este documento estabelece os termos aplicáveis a qualquer pessoa, pesquisador(a), auditor(a) ou colaborador(a) (**"Revisor"**) que visualizar, clonar, bifurcar (*fork*), executar localmente ou interagir com o repositório `EIleven/exe-lula-revisao` no GitHub.

O Proprietário disponibiliza no GitHub uma versão espelhada e sanitizada do código do sistema **Exe. Lula / HiperVerso** (mantendo o repositório principal de produção e suas credenciais estritamente privados) com a finalidade exclusiva de:

1. **Auditar e analisar** a arquitetura, implementação, fluxos de dados, federação ActivityPub, mensageria P2P (Zero DB), criptografia E2EE, regras de segurança e desempenho;
2. **Reportar** falhas, vulnerabilidades, gargalos ou recomendações técnicas;
3. **Propor correções e melhorias** por meio de *Issues* e *Pull Requests (PRs)* estruturados neste repositório.

---

## 2. Compromissos de Quem Acessa via GitHub

Ao visualizar, clonar, criar *fork*, executar localmente ou abrir qualquer *Issue* / *Pull Request* em `exe-lula-revisao`, você concorda integralmente com as seguintes condições:

- **Código proprietário (não é open source):** este repositório é **Source-Available proprietário**, regido exclusivamente pela [`LICENSE`](./LICENSE) e por este acordo. Nenhuma licença open source (MIT, Apache, GPL, BSD etc.) se aplica.
- **Uso estritamente para estudo, auditoria e contribuição:** o código pode ser lido no GitHub e executado em ambiente local de testes/emuladores apenas para fins de análise técnica, validação de correções e envio de melhorias ao projeto oficial.
- **Proibição de uso comercial, paralelo ou concorrente:** é proibido utilizar este código, sua arquitetura, marca ou interface para subir instância concorrente, clone, fork independente em produção ou serviço comercial/público próprio ou de terceiros.
- **Proibição de redistribuição externa:** é proibido republicar, empacotar ou redistribuir o código-fonte (no todo ou em partes) fora dos mecanismos padrão de visualização e *fork* vinculados ao fluxo de revisão neste repositório no GitHub.
- **Proibição de treinamento e coleta automatizada:** é vedado usar este repositório ou o sistema em produção para scraping em massa, coleta automatizada ou treinamento/ajuste de modelos e datasets externos.
- **Titularidade das contribuições (PRs):** qualquer correção, código, sugestão ou *Pull Request* submetido neste repositório passa a integrar o projeto sob titularidade exclusiva do Proprietário, podendo ser incorporado livremente ao repositório principal privado e ao ambiente de produção.
- **Divulgação responsável de falhas:** eventuais vulnerabilidades críticas ou falhas sensíveis de segurança devem ser reportadas de forma responsável via template `Audit Finding` ou diretamente ao Proprietário (`brenobarros11@hotmail.com`) antes de qualquer exposição pública.

---

## 3. Fluxo de Trabalho para Revisores no GitHub

1. Leia atentamente o [`README.md`](./README.md) e o [`CONTRIBUTING.md`](./CONTRIBUTING.md).
2. Caso queira propor uma correção, faça um *fork* ou crie uma branch descritiva a partir da `main` (ex.: `fix/nome-do-ajuste` ou `audit/nome-da-analise`).
3. Preencha o template padrão de Pull Request descrevendo causa raiz, impacto e validações executadas (`npm run typecheck`, `npm run lint` e checagens em `e2e/`).
4. Toda contribuição passa pela revisão do Proprietário antes de ser incorporada ao repositório principal privado.

---

## 4. Aceite e Vigência

O acesso ao repositório no GitHub (`EIleven/exe-lula-revisao`), a criação de clone/*fork* ou a abertura de qualquer *Issue* ou *Pull Request* constitui manifestação inequívoca de ciência e concordância integral com este termo e com a [`LICENSE`](./LICENSE).

> *Nota: Este documento formaliza as condições de acesso, auditoria e contribuição via GitHub, sem prejuízo da legislação aplicável (Lei nº 9.609/1998 — Lei de Software e Lei nº 9.610/1998 — Direitos Autorais).*
