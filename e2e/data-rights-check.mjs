#!/usr/bin/env node
/**
 * Testa o canal de atendimento ao titular (src/lib/rights/dataRequest.ts) sem app nem emuladores.
 *   node e2e/data-rights-check.mjs
 *
 * Além da regra, este teste guarda duas decisões que são fáceis de perder de vista:
 *
 * 1. **Coleta mínima.** O registro do pedido tem SEIS campos e nenhum a mais. Se alguém acrescentar "CPF" ou
 *    "documento" ao formulário, a lista permitida na regra do Firestore reprova aqui.
 * 2. **A diferença entre autenticar e identificar.** A plataforma confirma controle da CONTA e do E-MAIL; ela não
 *    verifica identidade civil, e nenhum nível de garantia pode sugerir que verifica.
 *
 * Sai com código 1 se algo falhar.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const {
  DATA_REQUEST_DEADLINE_DAYS,
  DATA_REQUEST_KINDS,
  DATA_REQUEST_MESSAGE_MAX,
  DATA_REQUEST_STATUSES,
  CIVIL_IDENTITY_NEVER_REQUIRED,
  SELF_SERVICE_HINT,
  assuranceRequiredFor,
  buildDataRequestRecord,
  dueDateMillis,
  daysRemaining,
  isOpen,
  isOverdue,
  protocolFor,
  validateDataRequest,
} = await import('../src/lib/rights/dataRequest.ts');

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const DAY_MS = 24 * 60 * 60 * 1000;
let falhas = 0;

function confere(nome, condicao, motivo, detalhe) {
  if (condicao) console.log(`OK    ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  else { falhas++; console.log(`FALHA ${nome} — ${motivo}`); }
}

// ───────────────── 1. Prazo (LGPD, art. 19) ─────────────────

confere('o prazo de resposta é de 15 dias', DATA_REQUEST_DEADLINE_DAYS === 15, `está ${DATA_REQUEST_DEADLINE_DAYS}`);

const abertura = Date.UTC(2026, 10, 11, 12, 0, 0);
confere(
  'o vencimento é a abertura mais o prazo',
  dueDateMillis(abertura) === abertura + 15 * DAY_MS,
  'cálculo do vencimento errado',
  new Date(dueDateMillis(abertura)).toISOString().slice(0, 10),
);

const casosDePrazo = [
  ['no dia da abertura restam 15 dias', 0, 15, false],
  ['no dia seguinte restam 14', 1 * DAY_MS, 14, false],
  ['no 15º dia resta 0', 15 * DAY_MS, 0, false],
  ['passado o prazo fica negativo e atrasado', 16 * DAY_MS, -1, true],
  ['muito atrasado', 45 * DAY_MS, -30, true],
];
for (const [nome, decorrido, restamEsperado, atrasadoEsperado] of casosDePrazo) {
  const agora = abertura + decorrido;
  const restam = daysRemaining(abertura, agora);
  const atrasado = isOverdue(abertura, agora);
  confere(
    nome,
    restam === restamEsperado && atrasado === atrasadoEsperado,
    `restam ${restam} (esperado ${restamEsperado}), atrasado ${atrasado} (esperado ${atrasadoEsperado})`,
    `${restam} dia(s)`,
  );
}

// ───────────────── 2. Autenticar não é identificar ─────────────────

confere(
  'identidade civil NUNCA é exigida',
  CIVIL_IDENTITY_NEVER_REQUIRED === true,
  'a constante que trava essa decisão foi alterada',
);

const niveis = new Set(DATA_REQUEST_KINDS.map(assuranceRequiredFor));
const PERMITIDOS = new Set(['conta-autenticada', 'email-confirmado', 'senha-reconfirmada']);
confere(
  'nenhum tipo de pedido exige nível além de conta, e-mail ou senha',
  [...niveis].every((n) => PERMITIDOS.has(n)),
  `nível fora do permitido: ${[...niveis].filter((n) => !PERMITIDOS.has(n)).join(', ')}`,
  [...niveis].join(', '),
);
confere(
  'exclusão e correção pedem a senha de novo',
  assuranceRequiredFor('exclusao') === 'senha-reconfirmada' &&
    assuranceRequiredFor('correcao') === 'senha-reconfirmada',
  'mudar ou apagar dado deveria reconfirmar a senha',
);
confere(
  'só estar logado basta para os pedidos de leitura',
  assuranceRequiredFor('confirmacao-e-acesso') === 'conta-autenticada' &&
    assuranceRequiredFor('compartilhamento') === 'conta-autenticada',
  'pedido de leitura não deveria exigir mais que estar logado',
);

// ───────────────── 3. Validação do que a pessoa escreve ─────────────────

confere('todos os sete direitos estão oferecidos', DATA_REQUEST_KINDS.length === 7, `são ${DATA_REQUEST_KINDS.length}`);
for (const kind of DATA_REQUEST_KINDS) {
  const r = validateDataRequest({ kind });
  if (!r.ok) { falhas++; console.log(`FALHA tipo "${kind}" deveria ser aceito`); }
}
console.log(`OK    cada um dos ${DATA_REQUEST_KINDS.length} tipos é aceito sem mensagem`);

confere(
  'a mensagem é OPCIONAL',
  validateDataRequest({ kind: 'correcao' }).ok && validateDataRequest({ kind: 'correcao', message: '' }).ok,
  'exigir justificativa para exercer um direito seria criar obstáculo que a lei não criou',
);
confere(
  'tipo inventado é recusado',
  validateDataRequest({ kind: 'me-da-tudo' }).reason === 'tipo-invalido',
  'tipo desconhecido deveria ser recusado',
);
confere(
  'tipo vazio é recusado',
  validateDataRequest({ kind: '' }).reason === 'tipo-invalido',
  'tipo vazio deveria ser recusado',
);
confere(
  'mensagem longa demais é recusada',
  validateDataRequest({ kind: 'correcao', message: 'x'.repeat(DATA_REQUEST_MESSAGE_MAX + 1) }).reason === 'mensagem-longa',
  `deveria recusar acima de ${DATA_REQUEST_MESSAGE_MAX}`,
);
confere(
  'mensagem no limite é aceita, e vem sem espaços nas pontas',
  validateDataRequest({ kind: 'correcao', message: `  ${'x'.repeat(DATA_REQUEST_MESSAGE_MAX - 4)}  ` }).ok,
  'o limite deveria valer para o texto já aparado',
);

// ───────────────── 4. Registro mínimo ─────────────────

const registro = buildDataRequestRecord('uid123', 'exclusao', 'apaguem meus posts de 2024');
const campos = Object.keys(registro).sort().join(',');
confere(
  'o registro tem exatamente os campos previstos, e nenhum a mais',
  campos === 'assurance,kind,message,status,userId',
  `campos: ${campos}`,
  campos,
);
confere(
  'o pedido nasce como recebido',
  registro.status === 'recebido' && DATA_REQUEST_STATUSES.includes(registro.status),
  `nasceu ${registro.status}`,
);
confere(
  'o nível de garantia fica registrado para auditoria',
  registro.assurance === 'senha-reconfirmada',
  `gravou ${registro.assurance}`,
);
confere(
  'recebido e em análise contam como abertos; respondido e recusado, não',
  isOpen('recebido') && isOpen('em-analise') && !isOpen('respondido') && !isOpen('recusado'),
  'a noção de pedido aberto está errada',
);

// ───────────────── 5. Protocolo ─────────────────

const p1 = protocolFor('abc123XYZ');
confere('o protocolo é determinístico', p1 === protocolFor('abc123XYZ'), 'o mesmo pedido mudou de protocolo', p1);
confere('o protocolo tem o formato SOB-XXXXXX', /^SOB-[A-Z2-9]{6}$/.test(p1), `veio ${p1}`);
confere(
  'o protocolo não usa caracteres que se confundem ao ditar',
  !/[IO01]/.test(p1.slice(4)),
  `${p1} tem I, O, 0 ou 1`,
);
const protocolos = new Set(
  Array.from({ length: 500 }, (_, i) => protocolFor(`doc-${i}-${i * 7919}`)),
);
confere(
  'protocolos diferentes para pedidos diferentes',
  protocolos.size > 480,
  `500 ids geraram só ${protocolos.size} protocolos distintos`,
  `${protocolos.size}/500 distintos`,
);

// ───────────────── 6. Atalhos de autoatendimento ─────────────────

confere(
  'portabilidade e acesso apontam para a exportação que já existe',
  SELF_SERVICE_HINT.portabilidade === 'exportar' && SELF_SERVICE_HINT['confirmacao-e-acesso'] === 'exportar',
  'mandar a pessoa para a fila quando ela resolve sozinha é burocracia inventada',
);
confere(
  'exclusão aponta para a exclusão de conta, e revogação para as preferências',
  SELF_SERVICE_HINT.exclusao === 'excluir-conta' && SELF_SERVICE_HINT['revogacao-consentimento'] === 'preferencias',
  'atalhos de autoatendimento incorretos',
);

// ───────────────── 7. As regras do Firestore concordam ─────────────────

const regras = readFileSync(join(RAIZ, 'firestore.rules'), 'utf8');
const bloco = regras.slice(regras.indexOf('match /dataRequests/'), regras.indexOf('match /userFiles/'));

confere('existe regra para dataRequests', bloco.length > 0, 'não achei o bloco de dataRequests nas regras');
confere(
  'a regra permite SÓ os seis campos do registro',
  bloco.includes("hasOnly(['userId', 'kind', 'message', 'status', 'assurance', 'createdAt'])"),
  'a lista de campos permitidos mudou — nenhum documento, CPF ou selfie pode entrar aqui',
);
confere(
  'a regra exige que o pedido nasça como recebido',
  bloco.includes("request.resource.data.status == 'recebido'"),
  'o cliente poderia abrir pedido já respondido',
);
confere(
  'a data é do servidor, não do aparelho',
  bloco.includes('request.resource.data.createdAt == request.time'),
  'sem isso o prazo de 15 dias seria contado de uma data escolhida pelo cliente',
);
confere(
  'o limite de tamanho da mensagem está na regra, não só no formulário',
  bloco.includes(`request.resource.data.message.size() <= ${DATA_REQUEST_MESSAGE_MAX}`),
  'validação só no cliente é contornável',
);
confere(
  'o titular NÃO reescreve o próprio pedido',
  bloco.includes('allow update: if isAdminUser()'),
  'a trilha do pedido precisa ser imutável para quem abriu',
);
confere(
  'a resposta do administrador só toca estado e resposta',
  bloco.includes("hasOnly(['status', 'response', 'respondedAt'])"),
  'o administrador poderia reescrever o que a pessoa pediu',
);
confere(
  'ninguém apaga pedido',
  /allow delete: if false;/.test(bloco),
  'apagar pedido destruiria a trilha de atendimento',
);
confere(
  'só o titular e o administrador leem',
  bloco.includes('isDataOwner(resource) || isAdminUser()'),
  'o texto do pedido pode ter dado pessoal; não pode ser legível por terceiros',
);

if (falhas) {
  console.log(`\n${falhas} falha(s) no canal do titular.`);
  process.exit(1);
}
console.log('\nCanal do titular OK: prazo, coleta mínima, protocolo e regras concordam.');
