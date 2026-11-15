#!/usr/bin/env node
/** Prova nos emuladores que a verificacao e barreira de backend, nao so de UI. */
import {
  ADMIN,
  EMU,
  PROJECT,
  authAccounts,
  emulatorsRunning,
  fsCreateAtServerTime,
  fsDelete,
  fsGetDoc,
  fsSet,
  signInRest,
  storageDelete,
  storageUpload,
} from './lib/harness.mjs';

let failures = 0;
const check = (name, condition, detail = '') => {
  if (condition) console.log(`OK    ${name}`);
  else {
    failures++;
    console.log(`FALHA ${name}${detail ? ` - ${detail}` : ''}`);
  }
};
const stamp = Date.now().toString(36);

async function createAccount(label, {verified, member}) {
  const email = `auth.${stamp}.${label}@example.test`;
  const password = 'Teste!123456';
  const created = await fetch(`${EMU.auth}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({email, password, returnSecureToken: true}),
  });
  const body = await created.json();
  if (!created.ok) throw new Error(`signUp ${label}: HTTP ${created.status}`);
  const updated = await fetch(
    `${EMU.auth}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`,
    {
      method: 'POST',
      headers: {...ADMIN, 'Content-Type': 'application/json'},
      body: JSON.stringify({
        localId: body.localId,
        emailVerified: verified,
        customAttributes: JSON.stringify(member ? {member: true} : {}),
      }),
    },
  );
  if (!updated.ok) throw new Error(`accounts:update ${label}: HTTP ${updated.status}`);
  const session = await signInRest(email, password);
  return {uid: body.localId, email, token: session.idToken};
}

await emulatorsRunning();
const unverified = await createAccount('unverified', {verified: false, member: true});
const verified = await createAccount('verified', {verified: true, member: true});
const noProfileClaim = await createAccount('no-member', {verified: true, member: false});
const target = await createAccount('target', {verified: true, member: true});

for (const [index, user] of [unverified, verified, noProfileClaim, target].entries()) {
  await fsSet(`users/${user.uid}`, {
    name: `Teste ${index}`,
    username: `auth_${stamp}_${index}`,
    profileVisibility: 'public',
  }, 'owner');
}
await fsSet(`users/${unverified.uid}/private/account`, {email: unverified.email}, 'owner');

const marker = (uid) => ({userId: uid});
const deniedEmail = await fsCreateAtServerTime(
  `users/${unverified.uid}/following`,
  target.uid,
  marker(target.uid),
  unverified.token,
);
check('e-mail nao confirmado nao segue', deniedEmail.status === 403, `HTTP ${deniedEmail.status}`);

const deniedMember = await fsCreateAtServerTime(
  `users/${noProfileClaim.uid}/following`,
  target.uid,
  marker(target.uid),
  noProfileClaim.token,
);
check('conta Auth sem claim de membro nao segue', deniedMember.status === 403, `HTTP ${deniedMember.status}`);

const allowed = await fsCreateAtServerTime(
  `users/${verified.uid}/following`,
  target.uid,
  marker(target.uid),
  verified.token,
);
check('membro com e-mail confirmado segue', allowed.status === 200, `HTTP ${allowed.status}`);

const object = (uid) => `user_uploads/${uid}/auth-test/test.png`;
const deniedUpload = await storageUpload(object(unverified.uid), Buffer.from('png'), 'image/png', unverified.token);
check('e-mail nao confirmado nao envia arquivo', deniedUpload.status === 403, `HTTP ${deniedUpload.status}`);
const noMemberUpload = await storageUpload(object(noProfileClaim.uid), Buffer.from('png'), 'image/png', noProfileClaim.token);
check('conta sem perfil nao envia arquivo', noMemberUpload.status === 403, `HTTP ${noMemberUpload.status}`);
const allowedUpload = await storageUpload(object(verified.uid), Buffer.from('png'), 'image/png', verified.token);
check('membro confirmado envia arquivo', allowedUpload.status === 200, `HTTP ${allowedUpload.status}`);

await fsSet(`users/${unverified.uid}/following/${target.uid}`, {userId: target.uid, createdAt: new Date()}, 'owner');
const cleanupAllowed = await fsDelete(`users/${unverified.uid}/following/${target.uid}`, unverified.token);
check('conta pendente ainda pode desfazer relacao', cleanupAllowed.status === 200, `HTTP ${cleanupAllowed.status}`);
const privateRead = await fsGetDoc(`users/${unverified.uid}/private/account`, unverified.token);
check('conta pendente le os proprios dados', privateRead.status === 200, `HTTP ${privateRead.status}`);
const profileDelete = await fsDelete(`users/${unverified.uid}`, unverified.token);
check('conta pendente nao fica impedida de excluir o perfil', profileDelete.status === 200, `HTTP ${profileDelete.status}`);
const uploadDelete = await storageDelete(object(verified.uid), verified.token);
check('exclusao de arquivo continua permitida', uploadDelete.status === 200, `HTTP ${uploadDelete.status}`);

check('as contas descartaveis existem no Auth emulado', (await authAccounts()).length >= 4);
console.log(failures ? `\n${failures} falha(s).` : '\nBarreiras de e-mail e membro passaram de ponta a ponta.');
process.exitCode = failures ? 1 : 0;
