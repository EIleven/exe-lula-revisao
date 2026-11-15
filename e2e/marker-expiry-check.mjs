#!/usr/bin/env node
/**
 * Testa o prazo de vida dos marcadores individuais de visualização e de clique no perfil, sem app nem emuladores.
 *   node e2e/marker-expiry-check.mjs
 *
 * O prazo vive em TRÊS lugares que precisam concordar: o cálculo no cliente
 * (src/lib/analytics/markerExpiry.ts), a janela aceita pela regra (`isExpiringMarker` em firestore.rules) e a
 * política de TTL que apaga o documento (fieldOverrides com "ttl": true em firestore.indexes.json). Mudar um e
 * esquecer os outros tem consequências silenciosas: ou a gravação passa a ser recusada, ou o marcador — que guarda
 * QUEM viu cada post — deixa de ser apagado e vira registro permanente de quem leu o quê.
 *
 * Este teste existe para isso não acontecer sem aviso. Sai com código 1 se algo falhar.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const {
  MARKER_TTL_DAYS,
  MARKER_TTL_SKEW_DAYS,
  MARKER_TTL_MIN_DAYS,
  MARKER_TTL_MAX_DAYS,
  markerExpiryMillis,
  markerExpiryIsAcceptable,
  decideMarkerMigration,
} = await import('../src/lib/analytics/markerExpiry.ts');

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const DAY_MS = 24 * 60 * 60 * 1000;
let falhas = 0;

function confere(nome, condicao, motivo, detalhe) {
  if (condicao) {
    console.log(`OK    ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
  } else {
    falhas++;
    console.log(`FALHA ${nome} — ${motivo}`);
  }
}

// ───────────────── 1. O prazo decidido ─────────────────

confere(
  'o marcador individual vive 90 dias',
  MARKER_TTL_DAYS === 90,
  `o prazo está em ${MARKER_TTL_DAYS} dias; a decisão de 2026-11-11 foi 90`,
  '90 dias',
);

const agora = Date.UTC(2026, 10, 11, 12, 0, 0);
confere(
  'o cálculo do vencimento soma exatamente o prazo',
  markerExpiryMillis(agora) === agora + MARKER_TTL_DAYS * DAY_MS,
  `veio ${markerExpiryMillis(agora)}`,
  new Date(markerExpiryMillis(agora)).toISOString(),
);

confere(
  'a janela da regra é o prazo mais ou menos a folga',
  MARKER_TTL_MIN_DAYS === MARKER_TTL_DAYS - MARKER_TTL_SKEW_DAYS &&
    MARKER_TTL_MAX_DAYS === MARKER_TTL_DAYS + MARKER_TTL_SKEW_DAYS,
  `janela ${MARKER_TTL_MIN_DAYS}–${MARKER_TTL_MAX_DAYS} não corresponde a ${MARKER_TTL_DAYS}±${MARKER_TTL_SKEW_DAYS}`,
  `${MARKER_TTL_MIN_DAYS}–${MARKER_TTL_MAX_DAYS} dias`,
);

// ───────────────── 2. Relógio torto do aparelho ─────────────────

// A folga existe para tolerar defasagem de relógio, e só isso. Horas de diferença passam; dias, não.
const casosDeRelogio = [
  ['relógio exato', 0, true],
  ['aparelho 1 hora adiantado', 1 * 60 * 60 * 1000, true],
  ['aparelho 12 horas atrasado', -12 * 60 * 60 * 1000, true],
  ['aparelho 12 horas adiantado', 12 * 60 * 60 * 1000, true],
  ['aparelho 2 dias adiantado (recusa)', 2 * DAY_MS, false],
  ['aparelho 2 dias atrasado (recusa)', -2 * DAY_MS, false],
  ['tentativa de guardar por 10 anos (recusa)', 3650 * DAY_MS, false],
  ['tentativa de expirar amanhã (recusa)', -89 * DAY_MS, false],
];

for (const [nome, desvio, esperado] of casosDeRelogio) {
  const valorDoCliente = markerExpiryMillis(agora + desvio);
  const aceito = markerExpiryIsAcceptable(valorDoCliente, agora);
  confere(
    nome,
    aceito === esperado,
    `a regra ${aceito ? 'aceitaria' : 'recusaria'}, esperado ${esperado ? 'aceitar' : 'recusar'}`,
    aceito ? 'aceito' : 'recusado',
  );
}

// ───────────────── 3. A regra do Firestore concorda ─────────────────

const regras = readFileSync(join(RAIZ, 'firestore.rules'), 'utf8');

confere(
  'firestore.rules define isExpiringMarker',
  regras.includes('function isExpiringMarker('),
  'a função isExpiringMarker não existe mais nas regras',
);

confere(
  'a regra exige createdAt do servidor e o campo expireAt',
  regras.includes("hasOnly(['userId', 'createdAt', 'expireAt'])") &&
    regras.includes('request.resource.data.createdAt == request.time'),
  'a regra não está mais exigindo os três campos com createdAt do servidor',
);

// Os números na chamada da regra precisam ser os mesmos da janela calculada no cliente.
const chamadas = [...regras.matchAll(/isExpiringMarker\(userId,\s*(\d+),\s*(\d+)\)/g)];
confere(
  'views e profileClicks usam o marcador que expira',
  chamadas.length === 2,
  `achei ${chamadas.length} usos de isExpiringMarker (esperado 2: views e profileClicks)`,
  `${chamadas.length} usos`,
);
const janelasErradas = chamadas.filter(
  ([, min, max]) => Number(min) !== MARKER_TTL_MIN_DAYS || Number(max) !== MARKER_TTL_MAX_DAYS,
);
confere(
  'a janela da regra bate com a do cliente',
  chamadas.length > 0 && janelasErradas.length === 0,
  `a regra usa ${janelasErradas.map((c) => `${c[1]}–${c[2]}`).join(', ')} e o cliente ${MARKER_TTL_MIN_DAYS}–${MARKER_TTL_MAX_DAYS}`,
  `${MARKER_TTL_MIN_DAYS}–${MARKER_TTL_MAX_DAYS} dias nos dois`,
);

confere(
  'os marcadores de curtida e repost continuam SEM expirar',
  regras.includes('isValidMarker(userId)'),
  'isValidMarker desapareceu: curtida e repost não devem expirar junto',
);

// ───────────────── 4. O TTL que de fato apaga ─────────────────

const indices = JSON.parse(readFileSync(join(RAIZ, 'firestore.indexes.json'), 'utf8'));
const ttlDeclarado = (colecao) =>
  (indices.fieldOverrides ?? []).some(
    (o) => o.collectionGroup === colecao && o.fieldPath === 'expireAt' && o.ttl === true,
  );

for (const colecao of ['views', 'profileClicks', '_functionEvents']) {
  confere(
    `existe política de TTL em expireAt para ${colecao}`,
    ttlDeclarado(colecao),
    'sem "ttl": true em firestore.indexes.json o documento nunca é apagado',
  );
}

// ───────────────── 5. O cliente grava o campo ─────────────────

const servico = readFileSync(join(RAIZ, 'src', 'lib', 'services', 'analyticsService.ts'), 'utf8');
const gravacoesComExpireAt = (servico.match(/expireAt: Timestamp\.fromMillis\(markerExpiryMillis\(\)\)/g) ?? []).length;
confere(
  'as duas gravações do cliente carregam expireAt',
  gravacoesComExpireAt === 2,
  `achei ${gravacoesComExpireAt} gravações com expireAt (esperado 2: visualização e clique no perfil)`,
  `${gravacoesComExpireAt} gravações`,
);
confere(
  'o cliente não inventa o prazo por conta própria',
  !/expireAt:[^\n]*\d{2,}\s*\*/.test(servico),
  'há aritmética de prazo solta no serviço; o valor deve vir de markerExpiry.ts',
);

// ───────────── 6. Migração dos marcadores antigos ─────────────

// Os marcadores gravados antes da mudança só têm `createdAt`. Sem `expireAt` o TTL não os vê, e as regras só
// permitem `create` — logo o conserto é administrativo. [nome, campos, ação esperada, já expirado?]
const casosDeMigracao = [
  ['quem já tem expireAt é deixado em paz (idempotência)', { hasExpireAt: true, createdAtMs: agora - 10 * DAY_MS }, 'ja-tem', undefined],
  ['marcador de hoje ganha 90 dias', { hasExpireAt: false, createdAtMs: agora }, 'atualizar', false],
  ['marcador de 89 dias ainda não expira', { hasExpireAt: false, createdAtMs: agora - 89 * DAY_MS }, 'atualizar', false],
  ['marcador de 90 dias já nasce vencido', { hasExpireAt: false, createdAtMs: agora - 90 * DAY_MS }, 'atualizar', true],
  ['marcador de 1 ano já nasce vencido', { hasExpireAt: false, createdAtMs: agora - 365 * DAY_MS }, 'atualizar', true],
  ['sem createdAt é inválido, não chuta data', { hasExpireAt: false }, 'invalido', undefined],
  ['createdAt nulo é inválido', { hasExpireAt: false, createdAtMs: null }, 'invalido', undefined],
  ['createdAt NaN é inválido', { hasExpireAt: false, createdAtMs: Number.NaN }, 'invalido', undefined],
  ['createdAt zero é inválido', { hasExpireAt: false, createdAtMs: 0 }, 'invalido', undefined],
  ['createdAt em texto é inválido', { hasExpireAt: false, createdAtMs: '2026-01-01' }, 'invalido', undefined],
];

for (const [nome, campos, acaoEsperada, expiradoEsperado] of casosDeMigracao) {
  const decisao = decideMarkerMigration(campos, agora);
  const problemas = [];
  if (decisao.action !== acaoEsperada) problemas.push(`ação ${decisao.action}, esperado ${acaoEsperada}`);
  if (acaoEsperada === 'atualizar') {
    const esperado = campos.createdAtMs + MARKER_TTL_DAYS * DAY_MS;
    if (decisao.expireAtMs !== esperado) problemas.push(`expireAt ${decisao.expireAtMs}, esperado ${esperado}`);
    if (decisao.alreadyExpired !== expiradoEsperado) {
      problemas.push(`alreadyExpired ${decisao.alreadyExpired}, esperado ${expiradoEsperado}`);
    }
  }
  if (acaoEsperada !== 'atualizar' && decisao.expireAtMs !== undefined) {
    problemas.push('não deveria propor valor de expireAt');
  }
  if (problemas.length) {
    falhas++;
    console.log(`FALHA ${nome} — ${problemas.join('; ')}`);
  } else {
    console.log(`OK    ${nome} — ${decisao.action}${decisao.alreadyExpired ? ', vencido' : ''}`);
  }
}

// A migração NUNCA deve mexer no agregado, e por isso grava só o campo `expireAt`.
const migracao = readFileSync(join(RAIZ, 'scripts', 'migrar-expireat-marcadores.mjs'), 'utf8');

confere(
  'a migração é dry-run por padrão',
  migracao.includes("args.has('--aplicar')") && /APLICAR\s*[?:&|]|if\s*\(!APLICAR/.test(migracao),
  'não achei o interruptor --aplicar: a migração não pode gravar sem ele',
);
confere(
  'a migração grava SÓ o campo expireAt (updateMask)',
  migracao.includes('updateMask') && migracao.includes("fieldPaths: ['expireAt']"),
  'sem updateMask restrito a expireAt a gravação pode encostar em outros campos',
);
confere(
  'a migração não recria documento que o TTL já apagou',
  migracao.includes('currentDocument') && migracao.includes('exists: true'),
  'falta a pré-condição exists: true',
);
// Grosseiro demais pegaria o próprio import de src/lib/analytics/markerExpiry.ts. O que interessa é outra coisa:
// que a migração não escreva no documento do agregado e não some em contador nenhum, e que toda gravação tenha a
// máscara restrita a `expireAt`.
const mascaras = migracao.match(/fieldPaths:\s*\[[^\]]*\]/g) ?? [];
confere(
  'a migração não toca no agregado nem em contador',
  !/analytics\/summary|increment/i.test(migracao) &&
    mascaras.length > 0 &&
    mascaras.every((m) => m.includes("'expireAt'")),
  `padrão suspeito, ou máscara fora de expireAt: ${mascaras.join(' ')}`,
);
confere(
  'a migração reutiliza a decisão testada aqui',
  migracao.includes('decideMarkerMigration'),
  'a migração está decidindo por conta própria em vez de usar markerExpiry.ts',
);

if (falhas) {
  console.log(`\n${falhas} falha(s) no prazo dos marcadores.`);
  process.exit(1);
}
console.log('\nMarcadores OK: cliente, regra, TTL e migração concordam em 90 dias.');
