# E-mail do domínio: pendência de decisão antes da abertura pública

**Decisão de 2026-11-11:** o canal do titular passou a ser **`admlabra@gmail.com`** — um único endereço real que
concentra suporte, privacidade e acessibilidade até a rede crescer. O interruptor
`NEXT_PUBLIC_CONTACT_EMAILS_ENABLED` **deixou de existir**: `src/config/site.ts` agora traz `enabled: true` e o
endereço fixo em `OWNER_CONTACT_EMAIL`. Deixar um canal obrigatório atrás de uma variável de ambiente permitia subir
produção sem canal nenhum — e foi exatamente o que aconteceu, com a política de privacidade dizendo no ar que o
contato "está sendo configurado". O plano abaixo segue valendo para quando houver caixa no domínio.

**Estado das caixas no domínio:** o serviço de e-mail **ainda não foi escolhido** e nenhuma caixa existe. Os endereços planejados são
`suporte@`, `privacidade@` e `acessibilidade@exercitodolula.app`. O app não os divulga: o interruptor
`NEXT_PUBLIC_CONTACT_EMAILS_ENABLED` está desligado e o componente `src/components/shared/ContactEmail.tsx` mostra uma
mensagem ("o canal de contato por e-mail está sendo configurado") no lugar do endereço. Isso vale para as páginas de ajuda,
cookies, acessibilidade, **privacidade e termos** e para as configurações. Até 2026-10-15 a política de privacidade e os
termos ainda traziam endereços de exemplo (`privacidade@soberan-app.exemplo.com`, `support@soberan-app.example.com`); foram
trocados pelo mesmo componente e `npm run check:domain` agora reprova `mailto:` com domínio de exemplo.

## O que a lei e o produto exigem

- A **Política de Privacidade precisa apresentar um contato real** para o titular exercer seus direitos (LGPD, art. 41: canal
  e identificação do encarregado). Enquanto não houver caixa, a página não cumpre isso: é **bloqueio para abrir a rede**.
- O endereço de acessibilidade e o de suporte aparecem nas páginas correspondentes; sem caixa, o aviso "será divulgado em
  breve" deve sair antes do lançamento.

## Decisão necessária: qual serviço

Critérios para escolher (a escolha é do projeto; nenhum valor de DNS abaixo é inventado, todos vêm do serviço escolhido):

| Opção | O que resolve | Atenção |
|---|---|---|
| Caixa de entrada e saída no domínio (provedor de e-mail com domínio próprio) | Receber e **responder** como `suporte@...`; várias pessoas na mesma caixa | Custo por usuário; exige MX, SPF, DKIM e DMARC |
| Encaminhamento (alias que reenvia para uma caixa existente) | Receber nos endereços do domínio sem criar caixas | Responder "como" `suporte@` exige também um serviço de envio autenticado; risco de cair em spam sem SPF/DKIM |
| Serviço de envio transacional (para e-mails do app) | Verificação de e-mail e redefinição de senha saindo do seu domínio | **Não** é caixa de entrada; precisa de SPF/DKIM próprios |

O Firebase Authentication envia por padrão de um endereço do próprio Firebase. Para que os e-mails do app saiam de
`@exercitodolula.app` é preciso configurar domínio personalizado no console do projeto **novo** (modelos de e-mail do
Authentication), que pede registros DNS fornecidos pelo Firebase. Isso fica para depois de criar o projeto.

## Registros DNS que o serviço escolhido vai exigir

A zona DNS hoje está no GoDaddy (servidores `ns75` e `ns76.domaincontrol.com`). Ao adicionar, **preservar os registros
existentes** que não forem de e-mail (o A "Parked" e o CNAME do `www` são tratados na fase de publicação):

| Registro | Para quê | Observação |
|---|---|---|
| **MX** (apex) | Onde chega o e-mail | Valores e prioridades do provedor |
| **SPF** (TXT no apex) | Quem pode enviar em nome do domínio | Só **um** registro SPF por domínio; ao somar serviços, junta-se num único `v=spf1 ... -all` |
| **DKIM** (TXT ou CNAME, `seletor._domainkey`) | Assinatura das mensagens | Chave e seletor do provedor; um por serviço de envio |
| **DMARC** (TXT em `_dmarc`) | Política para quem falha SPF/DKIM e relatórios | Começar com `p=none` e um endereço de relatório (`rua=`); subir para `quarantine` e depois `reject` quando os relatórios estiverem limpos |
| MTA-STS e TLS-RPT (opcionais) | Força TLS na entrega | Só depois do básico estável |

## Checklist antes da abertura

1. Escolher o serviço e criar as três caixas (ou aliases) com um responsável humano para cada.
2. Publicar MX, SPF, DKIM e DMARC com os valores do provedor (com aprovação do usuário para qualquer alteração de DNS).
3. Testar recebimento e envio de e-mail real (inclusive que não caia em spam) e conferir SPF/DKIM/DMARC por consulta DNS.
4. Trocar `OWNER_CONTACT_EMAIL` em `src/config/site.ts` pelos endereços do domínio e conferir, no navegador, as páginas de ajuda,
   cookies, acessibilidade, privacidade e termos.
5. Configurar o domínio de envio do Firebase Authentication no projeto novo.
