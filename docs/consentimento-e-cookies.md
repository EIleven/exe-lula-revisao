# Consentimento e cookies

**Estado:** o gate de consentimento está implementado e testado localmente (`npm run e2e:consent`), **não publicado**.
Fecha o item P0 "impedir rastreamento opcional sem consentimento". Os documentos legais (Política de Privacidade,
Termos, Política de Cookies) ainda **não** foram reescritos e seguem com declarações incorretas — ver
[Pendências](#pendências-que-não-são-deste-checkpoint).

## O problema que isso resolve

Até 2026-11-11, `src/app/[locale]/layout.tsx` injetava o container do Google Tag Manager (`GTM-KPJ9MTNF`) em **toda
visita de produção**, com `strategy="afterInteractive"`. O único freio era `!firebaseEnv.useEmulators`: os testes
locais estavam protegidos, o usuário real não. Não havia aviso de cookies, nem escolha, nem Consent Mode. O
`<iframe>` de `<noscript>` do GTM também disparava.

Em paralelo, `src/lib/firebase.ts` iniciava o Google Analytics na importação do módulo, bastando existir um
`measurementId`. Em produção a variável `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` não está configurada, então ele não
rodava — mas era questão de alguém definir a variável para passar a medir sem aviso.

Base da correção: LGPD, art. 7º (nenhum tratamento sem base legal) e art. 8º (consentimento livre, informado,
inequívoco e revogável). Pedir o script ao `googletagmanager.com` já entrega IP e cabeçalhos do visitante a um
terceiro, antes de qualquer tag disparar — por isso o gate bloqueia o **download**, e não só o disparo.

## Como funciona

Três camadas, de fora para dentro:

| Camada | Arquivo | O que faz |
|---|---|---|
| Negativa de partida | `src/app/layout.tsx` | `beforeInteractive` com Consent Mode v2 negando tudo que é opcional, antes de qualquer tag, em toda página |
| Decisão | `src/lib/consent/consentState.ts` | Lê, valida e traduz a escolha em sinais. Lógica pura, sem navegador nem React |
| Carregamento | `src/components/consent/` | GTM e AdSense só são montados se houver aceite |

A decisão fica no `localStorage`, chave `soberan_consent`, com `{ version, decidedAt, analytics, marketing }`.
`decidedAt` é o registro mínimo para demonstrar o consentimento (art. 8º, § 1º).

**O padrão é sempre negar.** Sem decisão, com JSON corrompido, com campo faltando, com tipo errado, com versão antiga
do aviso ou com o armazenamento bloqueado (navegação privada), o resultado é o mesmo: nada opcional carrega.

### Categorias

- **Estritamente necessários** — sessão, idioma, tema e proteção contra abuso. Sem interruptor: não há escolha a
  fazer e fingir que há seria enganoso. (`functionality_storage` e `security_storage` sempre concedidos.)
- **Medição de uso** — Google Analytics via Tag Manager. Desligada até aceite.
- **Publicidade** — a rede não exibe anúncios hoje (`siteConfig.adsEnabled=false`), mas a categoria existe para que
  religar os anúncios não reabra o vazamento: o `AdSenseScript` exige a flag **e** o consentimento.

### Não há dark pattern

"Aceitar tudo" e "Rejeitar tudo" são o mesmo botão em tamanho, cor e posição (`flex-1`, variante `default`).
Recusar custa um clique, igual a aceitar. **Isso é requisito, não estética** — um botão de recusa escondido ou
apagado invalida o consentimento. Há comentário no `ConsentBanner.tsx` avisando quem for mexer nos pesos.

## Como validar

### Teste automatizado

```powershell
. E:\Soberan\tools\activate-env.ps1   # Node 22 (o Node 18 do PATH não importa .ts)
npm run e2e:consent
```

33 verificações, sem app e sem emuladores. Além da regra, o teste **varre `src/`** e reprova qualquer referência a
`googletagmanager.com` ou `googlesyndication.com` fora de `src/lib/consent/` e `src/components/consent/` — é o guarda
para o GTM solto não voltar por descuido. Ele ignora menções em comentários (uma explicação da regra não é uma tag
sendo injetada), mas **não** ignora um endereço dentro de uma string.

### Conferência manual no navegador

Com o app rodando (`npm run dev`), em uma aba nova:

1. DevTools → Network, filtro `googletagmanager`. Carregue a página: **nenhum pedido** deve aparecer e o banner deve
   estar visível.
2. Console: `window.dataLayer` deve existir e o primeiro item deve ser o `consent default` com `denied` nas opcionais.
3. Clique em **Rejeitar tudo**. O banner sai, e ainda assim **nenhum** pedido ao `googletagmanager`.
4. Recarregue. O banner **não** volta (a recusa é uma decisão) e nada é pedido.
5. Settings → Sobre → **Preferências de privacidade** → ligue "Medição de uso" → Salvar. Agora o pedido ao
   `googletagmanager.com/gtm.js` aparece — e só agora.
6. Volte às preferências e desligue. Confirme que a revogação é gravada (`localStorage.soberan_consent`).
7. Repita em `pt-BR` e `en`, e com a janela estreita (celular).

## Operação

**Mudou o texto do aviso ou as categorias? Suba `CONSENT_NOTICE_VERSION`** em
`src/lib/consent/consentState.ts`. Toda decisão anterior deixa de valer e a pergunta volta para todos — consentimento
dado para outro texto não cobre tratamento novo (art. 8º, § 4º). É um número só, de propósito.

Para ligar a medição de fato é preciso, além do consentimento, definir
`NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` no `apphosting.yaml` e chamar `getAnalyticsIfConsented()` no cliente. Hoje
nenhuma das duas coisas existe, e o Analytics do Firebase não é iniciado em lugar nenhum.

## Pendências que não são deste checkpoint

| Item | Situação |
|---|---|
| Registro da decisão no servidor | A decisão vive só no `localStorage` do visitante. Para demonstrar consentimento de forma auditável falta gravar no Firestore (exige regra nova e, portanto, aprovação) |
| Documentos legais | Política de Privacidade (datada de 17/10/2023), Termos e Política de Cookies seguem com texto de template e declarações incorretas |
| Canal do titular | Definido como `admlabra@gmail.com`; falta publicá-lo nos documentos e ligar o interruptor correspondente |
| Inventário de cookies | A Política de Cookies não lista um único cookie concreto (nome, finalidade, prazo, quem define) |
| Revogação propagada | Revogar hoje para de enviar sinais e impede novos carregamentos; não apaga o que o Google já coletou |
