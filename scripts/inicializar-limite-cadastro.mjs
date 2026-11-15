#!/usr/bin/env node
/**
 * Inicializa (e reconcilia) o limite dos primeiros usuários: o documento de controle _signup/control e uma "vaga"
 * (_signup/control/slots/{uid}) para cada perfil que já existe. Usa a API REST do Firestore.
 *
 *   node scripts/inicializar-limite-cadastro.mjs                       emuladores, só mostra o plano
 *   node scripts/inicializar-limite-cadastro.mjs --aplicar             emuladores, grava
 *   node scripts/inicializar-limite-cadastro.mjs --producao            produção, só mostra o plano
 *   node scripts/inicializar-limite-cadastro.mjs --producao --aplicar  produção, grava (só com autorização)
 *   --limite=500    limite de vagas (padrão: o que já está no documento de controle; se não existe, 500)
 *   --conferir      não grava; sai com código 1 se houver algo a mudar (verificação de divergência)
 *
 *   --isentar=uid1,uid2 --motivo="robô de notícias"   tira a vaga da conta da contagem das PESSOAS (robôs e contas da casa)
 *   --desisentar=uid1                                  devolve a conta à contagem (volta a ocupar vaga)
 *   --exigir-app-check=sim|nao                         liga ou desliga a verificação anti-robô (App Check) no cadastro
 *
 * Em produção o token vem de FIRESTORE_ACCESS_TOKEN (gcloud auth print-access-token --account=<dono do projeto>) e
 * nunca é impresso.
 *
 * O que significa "vaga": as vagas são HISTÓRICAS. Cada UID que já recebeu uma vaga a mantém para sempre, mesmo que a
 * conta seja excluída (excluir NÃO libera vaga para outra pessoa). O contador "used" é sempre igual ao número de
 * documentos em slots/ que NÃO são isentos, e o cadastro (Functions createUserProfile e claimGoogleProfile) confere e
 * incrementa o contador numa transação. Conta isenta (robô ou da casa) tem a vaga marcada `exempt: true`: continua com o
 * perfil, mas não gasta uma das vagas das pessoas. Só este script isenta: o cliente não consegue.
 *
 * O que faz (idempotente: rodar de novo só grava se algo mudou):
 *  1. Cria a vaga de cada perfil existente que ainda não tem uma, numerando pela data de criação do perfil.
 *  2. Aplica as isenções pedidas.
 *  3. Cria o documento de controle com o limite e used = vagas não isentas, ou corrige o que divergir.
 * Tudo vai em UMA gravação atômica, com pré-condição no documento de controle: se um cadastro entrar no meio, a gravação
 * falha e o script recalcula (até 5 tentativas), sem nunca perder nem duplicar uma vaga.
 *
 * Ordem em produção: rode este script ANTES de publicar as Functions novas e de novo depois (confirma que nenhum cadastro
 * escapou da contagem), e só então publique as regras que fecham a criação direta pelo cliente.
 */

const flagValue = (name) => process.argv.slice(2).find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
const listFlag = (name) => (flagValue(name) ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const args = new Set(process.argv.slice(2));
const PROD = args.has('--producao');
const APPLY = args.has('--aplicar');
const CHECK_ONLY = args.has('--conferir');
const limitArg = flagValue('--limite');
const REQUESTED_LIMIT = limitArg !== undefined ? Number(limitArg) : undefined;
const EXEMPT = listFlag('--isentar');
const UNEXEMPT = listFlag('--desisentar');
const EXEMPT_REASON = flagValue('--motivo');
const APP_CHECK = flagValue('--exigir-app-check');
if (limitArg !== undefined && !(Number.isInteger(REQUESTED_LIMIT) && REQUESTED_LIMIT > 0)) {
  console.error('--limite precisa ser um inteiro positivo (ex.: --limite=500).');
  process.exit(2);
}
if (CHECK_ONLY && APPLY) {
  console.error('--conferir não grava: não combine com --aplicar.');
  process.exit(2);
}
if (EXEMPT.length > 0 && !EXEMPT_REASON) {
  console.error('--isentar exige --motivo="..." (fica registrado na vaga).');
  process.exit(2);
}
if (EXEMPT.some((uid) => UNEXEMPT.includes(uid))) {
  console.error('o mesmo uid não pode estar em --isentar e --desisentar.');
  process.exit(2);
}
if (APP_CHECK !== undefined && !['sim', 'nao'].includes(APP_CHECK)) {
  console.error('--exigir-app-check aceita "sim" ou "nao".');
  process.exit(2);
}
if (CHECK_ONLY && (EXEMPT.length > 0 || UNEXEMPT.length > 0 || APP_CHECK !== undefined)) {
  console.error('--conferir não grava: não combine com --isentar, --desisentar nem --exigir-app-check.');
  process.exit(2);
}

const PROJECT = PROD ? 'echo-b5aw9' : 'demo-soberan';
const DATABASE = 'echo-db-124325';
const FIRESTORE_HOST = PROD ? 'https://firestore.googleapis.com' : `http://${process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080'}`;
const ROOT = `projects/${PROJECT}/databases/${DATABASE}/documents`;
const DEFAULT_LIMIT = 500;
const MAX_ATTEMPTS = 5;
const WRITES_PER_COMMIT = 400;

const token = PROD ? process.env.FIRESTORE_ACCESS_TOKEN : 'owner';
if (!token) {
  console.error('Defina FIRESTORE_ACCESS_TOKEN com um token de acesso da conta dona do projeto (o valor não é impresso).');
  process.exit(2);
}
const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  ...(PROD ? { 'x-goog-user-project': PROJECT } : {}),
};

async function call(method, url, body) {
  const response = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* corpo não JSON */ }
  if (!response.ok) {
    const error = new Error(`${method} ${url.replace(FIRESTORE_HOST, '').replace(`/v1/${ROOT}`, '')} -> HTTP ${response.status}: ${json?.error?.message ?? text.slice(0, 200)}`);
    error.status = response.status;
    error.firestoreStatus = json?.error?.status;
    throw error;
  }
  return json;
}
const firestore = (method, path, body) => call(method, `${FIRESTORE_HOST}/v1/${path}`, body);

const idOf = (doc) => doc.name.split('/').pop();
const intOf = (value) => (value ? Number(value.integerValue ?? value.doubleValue ?? NaN) : undefined);
const timeOf = (value) => (value?.timestampValue ? Date.parse(value.timestampValue) : undefined);

/** Lista uma coleção inteira (paginada). `mask` limita os campos lidos. */
async function listAll(collectionPath, mask = []) {
  const docs = [];
  let pageToken = '';
  do {
    const query = new URLSearchParams({ pageSize: '300' });
    if (pageToken) query.set('pageToken', pageToken);
    for (const field of mask) query.append('mask.fieldPaths', field);
    const page = await firestore('GET', `${ROOT}/${collectionPath}?${query}`);
    docs.push(...(page?.documents ?? []));
    pageToken = page?.nextPageToken ?? '';
  } while (pageToken);
  return docs;
}

/** Documento de controle (ou null se ainda não existe), com o updateTime para a pré-condição da gravação. */
async function readControl() {
  try {
    return await firestore('GET', `${ROOT}/_signup/control`);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

const short = (uid) => `${uid.slice(0, 6)}…`;
const timestamp = (ms) => ({ timestampValue: new Date(ms).toISOString() });

/** Calcula o que falta gravar a partir do estado atual. Não grava nada. */
async function buildPlan() {
  const [users, slots, control] = await Promise.all([
    listAll('users', ['createdAt']),
    listAll('_signup/control/slots', ['number', 'exempt']),
    readControl(),
  ]);

  const slotInfo = new Map(slots.map((slot) => [idOf(slot), { exempt: slot.fields?.exempt?.booleanValue === true }]));
  const profileIds = new Set(users.map(idOf));
  for (const uid of [...EXEMPT, ...UNEXEMPT]) {
    if (!profileIds.has(uid) && !slotInfo.has(uid)) throw new Error(`o uid ${uid} não tem perfil nem vaga: confira o código.`);
  }

  const missing = users
    .filter((user) => !slotInfo.has(idOf(user)))
    .map((user) => ({ uid: idOf(user), createdAt: timeOf(user.fields?.createdAt) }))
    // Pela ordem de criação do perfil (sem data vai por último, desempatando pelo uid: o plano fica estável).
    .sort((a, b) => (a.createdAt ?? Infinity) - (b.createdAt ?? Infinity) || a.uid.localeCompare(b.uid));

  const highest = Math.max(0, ...slots.map((slot) => intOf(slot.fields?.number) ?? 0));
  const firstNumber = Math.max(highest, slots.length) + 1;
  const now = Date.now();
  const newSlots = missing.map((entry, index) => ({
    uid: entry.uid,
    number: firstNumber + index,
    createdAt: entry.createdAt ?? now,
    exempt: EXEMPT.includes(entry.uid),
  }));

  // Vagas que já existem e mudam de estado (isentar ou devolver à contagem).
  const slotUpdates = [];
  for (const uid of EXEMPT) if (slotInfo.has(uid) && !slotInfo.get(uid).exempt) slotUpdates.push({ uid, exempt: true });
  for (const uid of UNEXEMPT) if (slotInfo.get(uid)?.exempt) slotUpdates.push({ uid, exempt: false });

  const exemptAfter = new Set([...slotInfo].filter(([, info]) => info.exempt).map(([uid]) => uid));
  for (const slot of newSlots) if (slot.exempt) exemptAfter.add(slot.uid);
  for (const change of slotUpdates) {
    if (change.exempt) exemptAfter.add(change.uid); else exemptAfter.delete(change.uid);
  }

  const currentLimit = intOf(control?.fields?.limit);
  const currentUsed = intOf(control?.fields?.used);
  const currentIssued = intOf(control?.fields?.issued);
  const currentRequire = control?.fields?.requireAppCheck?.booleanValue === true;
  const targetUsed = slots.length + newSlots.length - exemptAfter.size;
  const targetIssued = Math.max(highest, ...newSlots.map((slot) => slot.number), slots.length + newSlots.length);
  const targetLimit = REQUESTED_LIMIT ?? (Number.isInteger(currentLimit) ? currentLimit : DEFAULT_LIMIT);
  const targetRequire = APP_CHECK === undefined ? currentRequire : APP_CHECK === 'sim';

  return {
    users: users.length,
    existingSlots: slots.length,
    newSlots,
    slotUpdates,
    exemptCount: exemptAfter.size,
    control,
    currentLimit,
    currentUsed,
    currentIssued,
    currentRequire,
    targetLimit,
    targetUsed,
    targetIssued,
    targetRequire,
    requireChange: APP_CHECK !== undefined && targetRequire !== currentRequire,
    controlChanges: !control || currentLimit !== targetLimit || currentUsed !== targetUsed || currentIssued !== targetIssued || (APP_CHECK !== undefined && targetRequire !== currentRequire),
  };
}

const exemptFields = () => ({ exempt: { booleanValue: true }, exemptReason: { stringValue: EXEMPT_REASON ?? '' } });

/** Monta as gravações: vagas novas, vagas que mudam de estado e controle. */
function buildWrites(plan) {
  const writes = plan.newSlots.map((slot) => ({
    update: {
      name: `${ROOT}/_signup/control/slots/${slot.uid}`,
      fields: {
        number: { integerValue: String(slot.number) },
        provider: { stringValue: 'migration' },
        createdAt: timestamp(slot.createdAt),
        recordedAt: timestamp(Date.now()),
        ...(slot.exempt ? exemptFields() : {}),
      },
    },
    currentDocument: { exists: false }, // se já existe, a gravação falha e o plano é refeito
  }));
  for (const change of plan.slotUpdates) {
    writes.push({
      update: { name: `${ROOT}/_signup/control/slots/${change.uid}`, fields: change.exempt ? exemptFields() : {} },
      // Máscara com os dois campos: ao devolver à contagem, eles são apagados do documento.
      updateMask: { fieldPaths: ['exempt', 'exemptReason'] },
      currentDocument: { exists: true },
    });
  }
  if (plan.controlChanges) {
    const fields = {
      limit: { integerValue: String(plan.targetLimit) },
      used: { integerValue: String(plan.targetUsed) },
      issued: { integerValue: String(plan.targetIssued) },
      updatedAt: timestamp(Date.now()),
      ...(APP_CHECK !== undefined ? { requireAppCheck: { booleanValue: plan.targetRequire } } : {}),
    };
    const maskFields = ['limit', 'used', 'issued', 'updatedAt', ...(APP_CHECK !== undefined ? ['requireAppCheck'] : [])];
    if (plan.control) {
      writes.push({
        update: { name: `${ROOT}/_signup/control`, fields },
        updateMask: { fieldPaths: maskFields },
        currentDocument: { updateTime: plan.control.updateTime },
      });
    } else {
      writes.push({
        update: { name: `${ROOT}/_signup/control`, fields: { ...fields, createdAt: timestamp(Date.now()) } },
        currentDocument: { exists: false },
      });
    }
  }
  return writes;
}

const hasPending = (plan) => plan.newSlots.length > 0 || plan.slotUpdates.length > 0 || plan.controlChanges;

function describe(plan) {
  console.log(`${plan.users} perfis, ${plan.existingSlots} vagas já registradas (${plan.exemptCount} isenta(s) depois deste plano), ${plan.newSlots.length} vaga(s) a registrar`);
  for (const slot of plan.newSlots) console.log(`  vaga ${slot.number}: users/${short(slot.uid)} (${new Date(slot.createdAt).toISOString().slice(0, 10)})${slot.exempt ? ' ISENTA' : ''}`);
  for (const change of plan.slotUpdates) console.log(`  vaga de ${short(change.uid)}: ${change.exempt ? 'ISENTAR (não conta entre as pessoas)' : 'voltar a contar entre as pessoas'}`);
  if (!plan.control) {
    console.log(`  controle: CRIAR com limite ${plan.targetLimit} e ${plan.targetUsed} vaga(s) usada(s)`);
  } else if (plan.controlChanges) {
    console.log(`  controle: limite ${plan.currentLimit} -> ${plan.targetLimit}; usadas ${plan.currentUsed} -> ${plan.targetUsed}`);
  }
  if (plan.requireChange) console.log(`  anti-robô (App Check): ${plan.currentRequire ? 'ligado' : 'desligado'} -> ${plan.targetRequire ? 'LIGADO' : 'DESLIGADO'}`);
  if (plan.targetUsed > plan.targetLimit) {
    console.log(`  ATENÇÃO: ${plan.targetUsed} vagas usadas passam do limite ${plan.targetLimit}: o cadastro ficará fechado.`);
  }
  const pending = hasPending(plan);
  console.log(pending ? `${plan.newSlots.length} vaga(s) nova(s), ${plan.slotUpdates.length} mudança(s) de isenção e ${plan.controlChanges ? 1 : 0} documento de controle a gravar.` : 'nada a mudar');
  return pending;
}

console.log(`${PROD ? 'PRODUÇÃO' : 'emuladores'} | projeto ${PROJECT} | banco ${DATABASE} | ${APPLY ? 'GRAVANDO' : CHECK_ONLY ? 'só conferindo' : 'só o plano (use --aplicar para gravar)'}`);

let finalPlan = null;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const plan = await buildPlan();
  const pending = describe(plan);
  finalPlan = plan;
  if (!pending) break;
  if (!APPLY) {
    if (CHECK_ONLY) process.exitCode = 1;
    break;
  }
  const writes = buildWrites(plan);
  try {
    // Até WRITES_PER_COMMIT por gravação; o controle vai na última, junto com as vagas que couberem nela.
    for (let i = 0; i < writes.length; i += WRITES_PER_COMMIT) {
      await firestore('POST', `${ROOT}:commit`, { writes: writes.slice(i, i + WRITES_PER_COMMIT) });
    }
    console.log('gravado.');
    // Reconfere: o estado final precisa bater com o plano (nada a mudar).
    const after = await buildPlan();
    const stillPending = hasPending(after);
    console.log(stillPending ? 'ATENÇÃO: depois de gravar ainda há divergência.' : `conferido: limite ${after.targetLimit}, ${after.targetUsed} vaga(s) usada(s) por pessoas (${after.exemptCount} isenta(s)), ${after.users} perfil(is), anti-robô ${after.targetRequire ? 'LIGADO' : 'desligado'}.`);
    if (stillPending) process.exitCode = 1;
    finalPlan = after;
    break;
  } catch (error) {
    const concurrent = ['ABORTED', 'FAILED_PRECONDITION', 'ALREADY_EXISTS'].includes(error.firestoreStatus);
    if (!concurrent || attempt === MAX_ATTEMPTS) throw error;
    console.log(`o estado mudou durante a gravação (${error.firestoreStatus}); recalculando (tentativa ${attempt + 1} de ${MAX_ATTEMPTS})...`);
  }
}
if (finalPlan && !APPLY && !CHECK_ONLY) console.log('(nada foi gravado)');
