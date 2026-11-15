# Arquitetura da camada P2P opcional

> **Projeto, e com uma recomendação desconfortável.** Leia a seção 2 antes de qualquer coisa: para esta rede, no
> desenho mais comum, o P2P **expõe o endereço IP de quem participa**, e isso é grave o bastante para mudar o
> projeto inteiro.

## 1. O que se quer resolver

Três motivos legítimos para P2P: **resistência a bloqueio** (conteúdo continua acessível se o servidor cair ou for
derrubado), **custo** (quem participa ajuda a servir), e **soberania** (a pessoa guarda o próprio conteúdo).

## 2. O problema que decide o projeto: o IP

Em IPFS e libp2p, um nó que anuncia conteúdo na DHT **publica seus endereços de rede**. Qualquer pessoa pode
consultar quem está servindo um determinado CID. Isso significa que:

> **Qualquer um poderia descobrir o endereço IP das pessoas que guardam e distribuem um determinado conteúdo
> político.**

Numa rede com o perfil desta, isso não é detalhe técnico — é risco à integridade física de quem participa. IP entrega
localização aproximada e, com ordem judicial ao provedor de acesso, identidade civil. A LGPD trata IP como dado
pessoal, e aqui ele vazaria **para qualquer pessoa na internet**, sem requisição nenhuma.

**Conclusão:** não é aceitável que participar da camada P2P exponha o IP de um usuário comum sem aviso enorme e
escolha explícita. Isso elimina o desenho "todo mundo é um nó" e empurra para as opções da seção 3.

## 3. Três desenhos, e o que cada um custa

| | **A. Nós da casa** | **B. Opt-in individual** | **C. Opt-in com relay** |
|---|---|---|---|
| Quem serve | Só nós, em servidor nosso | Quem aceitar, do próprio aparelho | Quem aceitar, **atrás de relay** |
| IP exposto | Só o do servidor | **O da pessoa** | O do relay |
| Resistência a bloqueio | Baixa | Alta | Média |
| Custo | Nosso | Distribuído | Nosso (relay) |
| Complexidade | Baixa | Média | Alta |
| Risco à pessoa | Nenhum | **Alto** | Baixo |

**Recomendação: começar por A, e só então avaliar C. Não oferecer B** como desenho padrão — e, se algum dia for
oferecido, que seja com aviso explícito de que o endereço de rede fica público, em linguagem que não dê para
entender errado.

O desenho A já entrega soberania e endereçamento por conteúdo (o conteúdo passa a ter um identificador imutável e
verificável), sem transferir risco para quem não tem como avaliá-lo.

## 4. Tecnologia

**libp2p + IPFS (Kubo), com verificação.** Justificativa: endereçamento por conteúdo, implementação madura,
especificação aberta, e o Bergamot/WASM já mostrou que o projeto aceita incorporar open-source. Alternativas
consideradas: **Hypercore/Hyperswarm** (bom, mas ecossistema menor), **Iroh** (promissor, imaturo), **BitTorrent**
(ótimo para arquivo grande, ruim para objeto pequeno e mutável).

Fora de escopo: qualquer coisa com token, blockchain ou incentivo econômico. Não resolve problema desta rede e traz
regulação financeira para dentro.

## 5. O que entra, e o que nunca entra

**Elegível:** mídia de post **público** que a pessoa marcou para distribuição, e artigos públicos.

**Nunca, por padrão:**

| Dado | Por quê |
|---|---|
| Mensagens diretas | Privadas. Nem cifradas deveriam ir: metadado de quem busca o quê já vaza |
| Posts privados ou "só seguidores" | Conteúdo em rede distribuída é, na prática, público |
| Qualquer dado pessoal (e-mail, nascimento, perfil privado) | Não há como despublicar |
| Denúncias, moderação, incidentes | Sigilo |
| Conteúdo de conta não confirmada | Ver o fluxo de confirmação |
| **Conteúdo sensível, mesmo público** | Marcado como sensível fica fora: não há como retirar |

## 6. Chaves e revogação

- **Uma chave por dispositivo**, não por conta: assim perder um aparelho não compromete os outros.
- Chave gerada **no dispositivo** e nunca enviada ao servidor. O servidor guarda só a parte pública.
- **Revogar** um dispositivo invalida a chave dele; o conteúdo já distribuído **não volta**.
- **Rotação** sob demanda e ao revogar.
- Criptografia ponta a ponta **não se aplica** ao conteúdo público (que é público por definição). Se um dia houver
  compartilhamento restrito via P2P, ela passa a ser obrigatória — e é projeto próprio.

## 7. Metadados: o que se minimiza

Além do IP (§2): **o que você busca revela o que você lê**. Numa DHT, consultar um CID conta à rede que alguém
daquele endereço quer aquele conteúdo. Mitigações possíveis — e nenhuma perfeita: buscar sempre via gateway nosso
(o que anula parte do propósito), pré-carregar em lote para diluir o sinal, ou não participar.

**Honestidade necessária:** quem lê pela camada P2P tem menos privacidade de leitura do que quem lê pelo site.

## 8. Expiração, unpin e os limites da exclusão

```
pessoa apaga o conteúdo
        │
        ▼
 remove do nosso serviço ──────────► conteúdo fora do site: imediato e eficaz
        │
        ▼
 unpin nos nossos nós ─────────────► paramos de servir
        │
        ▼
 outros nós ainda têm o bloco ────► NÃO temos como apagar.
        │                            O bloco expira quando o cache deles expirar — ou nunca.
        ▼
 anúncio de retirada na rede ──────► melhor esforço, sem garantia
```

**Isso precisa estar escrito para o usuário antes de ele aderir, em letra grande:** conteúdo distribuído por P2P
**pode não ser removível**. É a diferença mais importante entre publicar no site e publicar na camada P2P.

## 9. Compatibilidade com pedido LGPD

| Direito | Como responder honestamente |
|---|---|
| Exclusão | Removemos do site e dos nossos nós, e anunciamos a retirada. **Não prometemos** apagar cópia de terceiro |
| Acesso e portabilidade | Os CIDs do conteúdo da pessoa entram na exportação |
| Oposição | Desligar a participação para o futuro; o passado segue o parágrafo da exclusão |
| Revogação | Desligar é imediato e não penaliza nada |

Por causa desses limites, **a adesão ao P2P é consentimento específico e destacado**, com a limitação explicada no
momento do aceite — não uma caixa marcada em configurações.

## 10. Abuso e conteúdo ilegal

Risco próprio e sério: uma rede distribuída pode ser usada para hospedar conteúdo ilegal, inclusive material de
abuso infantil, e um nó nosso poderia **servir** esse conteúdo sem saber.

Mitigações: só servimos conteúdo **originado na nossa rede e já moderado** (nunca um nó aberto que aceite qualquer
CID); denylist de CIDs; unpin imediato ao remover; e os nós da casa não funcionam como gateway público para a IPFS
inteira. Essa restrição é o que separa "distribuir o nosso conteúdo" de "operar infraestrutura para o conteúdo de
qualquer um" — e a segunda coisa nós não vamos fazer.

## 11. Quando **não** usar P2P

Com a mesma clareza do resto:

- **Não usar** se a pessoa não participante perder qualquer coisa — a rede tem de funcionar inteira sem P2P.
- **Não usar** para dado pessoal, mensagem privada ou conteúdo sensível, nunca.
- **Não usar** se a adesão expuser o IP sem aviso explícito e escolha (ou seja: não usar o desenho B).
- **Não usar** para resolver custo de servidor: hoje a rede é pequena e o problema não existe.
- **Não usar** antes de a adequação LGPD estar fechada e dos itens obrigatórios do checklist resolvidos.
- **Não usar** se não houver capacidade de moderação para a denylist de CIDs.

**Avaliação honesta do momento:** nenhum dos três motivos da seção 1 pressiona hoje. Não há bloqueio a resistir, o
custo é baixo e a soberania já é servida por exportação e portabilidade. O P2P é a parte **menos urgente** de tudo
que está nesta rodada, e tentá-lo antes de fechar as pendências obrigatórias seria trocar risco real por benefício
hipotético.

## 12. ADRs

**ADR-P2P-1 — Estritamente opt-in, sem penalidade.** *Aceita.* Quem não participa não perde recurso, alcance nem
velocidade.

**ADR-P2P-2 — Começar pelo desenho A (nós da casa).** *Aceita.* Entrega endereçamento por conteúdo sem transferir
risco de IP para o usuário.

**ADR-P2P-3 — Não oferecer o desenho B sem aviso explícito.** *Aceita.* Expor IP de quem debate política sem
entender a consequência é inaceitável, ainda que a pessoa tenha clicado em "aceito".

**ADR-P2P-4 — Nossos nós servem só conteúdo da nossa rede, já moderado.** *Aceita.* Nó aberto nos tornaria
infraestrutura de distribuição de conteúdo alheio, inclusive ilegal.

**ADR-P2P-5 — Conteúdo sensível fica fora, mesmo público.** *Aceita.* Sem possibilidade de retirada, não há como
corrigir erro.

**ADR-P2P-6 — Sem token, blockchain ou incentivo econômico.** *Aceita.*

## 13. Roteiro

| Fase | Entrega | Porta de saída |
|---|---|---|
| 0 | Este documento | Aprovação, **depois** das pendências obrigatórias do checklist |
| 1 | Prova de conceito: um nó da casa, CID de mídia pública, sem exposição ao usuário | Mede custo e latência reais |
| 2 | CIDs na exportação, como portabilidade | Não muda nada para quem não usa |
| 3 | Opt-in de distribuição por publicação, servida pelos nossos nós | Denylist e unpin funcionando |
| 4 | Avaliar desenho C (relay) | Só se houver demanda concreta |
| 5 | — | O desenho B segue **não recomendado** |
