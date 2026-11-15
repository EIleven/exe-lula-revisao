/**
 * @fileOverview Limite dos primeiros usuários e criação do perfil inicial.
 *
 * As vagas são HISTÓRICAS. _signup/control guarda o limite e quantas vagas já
 * foram dadas; _signup/control/slots/{uid} é a vaga de cada UID e nunca é
 * apagada: excluir a conta NÃO libera a vaga para outra pessoa, e repetir o
 * pedido do mesmo UID não consome outra.
 *
 * O cadastro por e-mail e o primeiro acesso com o Google passam pela MESMA
 * transação (claimSlotAndCreateProfile): ela confere o limite, reserva a vaga
 * e grava perfil, @ e dados pessoais de uma vez. Se qualquer parte falhar
 * (limite, @ já usado, Firestore), nada é consumido nem fica pela metade, e a
 * conta que o Auth acabou de criar é removida (sem usuário órfão).
 *
 * Se o documento de controle não existe, o cadastro FECHA (em vez de virar
 * ilimitado): rode scripts/inicializar-limite-cadastro.mjs.
 */
import {randomBytes} from "crypto";
import {HttpsError} from "firebase-functions/v2/https";
import {
  FieldValue,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import {getAuth, type UserRecord} from "firebase-admin/auth";
import * as logger from "firebase-functions/logger";

/** Motivo (em details) do erro de cadastro lotado, lido pelo cliente. */
export const SIGNUP_CLOSED_REASON = "signup-closed";
/** Motivo (em details) do erro de verificação anti-robô (App Check). */
export const APP_CHECK_REQUIRED_REASON = "app-check";

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,15}$/;
const NAME_MAX_LENGTH = 100;
const TRANSACTION_ATTEMPTS = 10;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 4096;
const OBVIOUS_PASSWORDS = new Set([
  "12345678", "123456789", "1234567890", "senha123", "password",
  "password1", "qwerty123", "brasil123", "lula1234", "11111111",
  "00000000", "abcd1234", "admin123", "mudar123",
]);

const controlRefOf = (db: Firestore) =>
  db.collection("_signup").doc("control");
const slotRefOf = (db: Firestore, uid: string) =>
  controlRefOf(db).collection("slots").doc(uid);
const userRefOf = (db: Firestore, uid: string) =>
  db.collection("users").doc(uid);
const privateRefOf = (db: Firestore, uid: string) =>
  userRefOf(db, uid).collection("private").doc("account");

/**
 * Erro de "vagas preenchidas", em português e inglês.
 * @param {number} limit Limite de vagas (público: é a regra do programa).
 * @return {HttpsError} Erro resource-exhausted.
 */
const closedError = (limit: number) =>
  new HttpsError(
    "resource-exhausted",
    `As ${limit} vagas iniciais do Exe. Lula foram preenchidas. / ` +
      `The first ${limit} spots on Exe. Lula have been filled.`,
    {reason: SIGNUP_CLOSED_REASON, limit}
  );

/**
 * Erro de cadastro indisponível (controle não inicializado ou corrompido).
 * @return {HttpsError} Erro failed-precondition.
 */
const unavailableError = () =>
  new HttpsError(
    "failed-precondition",
    "Cadastro temporariamente indisponível. / " +
      "Sign-up is temporarily unavailable.",
    {reason: "signup-unavailable"}
  );

const usernameTakenError = () =>
  new HttpsError("already-exists", "This username is already taken.");

/**
 * Erro de verificação anti-robô: a chamada não trouxe um token válido do App
 * Check (reCAPTCHA), que só um navegador de pessoa real consegue obter.
 * @return {HttpsError} Erro failed-precondition com o motivo "app-check".
 */
const appCheckRequiredError = () =>
  new HttpsError(
    "failed-precondition",
    "Não foi possível confirmar que você é uma pessoa. Recarregue a página e " +
      "tente de novo (bloqueadores de anúncios ou de privacidade podem " +
      "impedir a verificação). / We could not confirm you are a person. " +
      "Reload the page and try again (ad or privacy blockers can prevent " +
      "the check).",
    {reason: APP_CHECK_REQUIRED_REASON}
  );

/**
 * Safely extract an error code.
 * @param {unknown} err Unknown error.
 * @return {string|undefined} The code, if any.
 */
const errorCode = (err: unknown): string | undefined =>
  typeof err === "object" && err !== null && "code" in err ?
    String(err.code) :
      undefined;

/** Mesma política do cliente; o console do Auth deve repeti-la. */
const isAcceptablePassword = (password: string, email: string): boolean => {
  if (
    password.length < PASSWORD_MIN_LENGTH ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    return false;
  }
  const lower = password.toLowerCase();
  if (
    /^\d+$/.test(password) ||
    new Set(password).size === 1 ||
    OBVIOUS_PASSWORDS.has(lower)
  ) {
    return false;
  }
  const local = email.split("@")[0]?.trim().toLowerCase();
  return !(local && local.length >= 4 && lower.includes(local));
};

/** Data ISO e declaração de 18 anos, sem afirmar identidade verificada. */
export const isAdultBirthDate = (
  value: unknown,
  now = new Date()
): value is string => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    year < 1900
  ) return false;
  const cutoff = new Date(Date.UTC(
    now.getUTCFullYear() - 18,
    now.getUTCMonth(),
    now.getUTCDate()
  ));
  return parsed <= cutoff;
};

/** Preserva claims existentes e acrescenta a condição de membro. */
export const ensureMemberClaim = async (record: UserRecord): Promise<void> => {
  if (record.customClaims?.member === true) return;
  await getAuth().setCustomUserClaims(record.uid, {
    ...(record.customClaims ?? {}),
    member: true,
  });
};

type Control = {
  limit: number;
  used: number;
  /**
   * Maior número histórico emitido; não diminui quando uma vaga é isenta.
   */
  issued: number;
  requireAppCheck: boolean;
};

/**
 * Lê o documento de controle e confere que os dois números são válidos.
 * `used` conta só as vagas de PESSOAS: contas de robô ou da casa (como a
 * Mariana) têm vaga marcada como isenta e não entram na conta.
 * `requireAppCheck` liga a verificação anti-robô (App Check) no cadastro.
 * @param {FirebaseFirestore.DocumentData|undefined} data Dados do documento.
 * @return {Control|null} Limite, vagas usadas e anti-robô, ou null se inválido.
 */
const parseControl = (
  data: FirebaseFirestore.DocumentData | undefined
): Control | null => {
  const limit = data?.limit;
  const used = data?.used;
  // Compatibilidade durante a implantação: controles antigos não tinham
  // `issued`. O script administrativo o reconcilia antes de ligar as novas
  // Functions; até lá, `used` preserva o comportamento anterior.
  const issued = data?.issued ?? used;
  if (
    !Number.isInteger(limit) ||
    !Number.isInteger(used) ||
    !Number.isInteger(issued) ||
    limit < 0 ||
    used < 0 ||
    issued < 0
  ) {
    return null;
  }
  return {
    limit,
    used,
    issued,
    requireAppCheck: data?.requireAppCheck === true,
  };
};

/**
 * Anti-robô: com `requireAppCheck` ligado no documento de controle, só passa
 * quem trouxe um token válido do App Check. Desligado, não muda nada (é o
 * estado até o site novo, que envia o token, estar no ar).
 * @param {Firestore} db Banco.
 * @param {boolean} hasAppCheck A chamada trouxe um token válido?
 * @return {Promise<void>} Resolve se pode seguir; lança se não.
 */
export const assertHuman = async (db: Firestore, hasAppCheck: boolean) => {
  if (hasAppCheck) {
    return;
  }
  const control = parseControl((await controlRefOf(db).get()).data());
  if (control?.requireAppCheck) {
    throw appCheckRequiredError();
  }
};

/**
 * Situação do cadastro para a tela: aberto ou lotado. Não devolve a
 * quantidade de vagas usadas (contador administrativo).
 * @param {Firestore} db Banco.
 * @return {Promise<{open: boolean, limit: number}>} Situação pública.
 */
export const readSignupStatus = async (db: Firestore) => {
  const control = parseControl((await controlRefOf(db).get()).data());
  if (!control) {
    throw unavailableError();
  }
  return {open: control.used < control.limit, limit: control.limit};
};

export type ProfileSeed = {
  uid: string;
  name: string;
  email: string;
  dateOfBirth: string | null;
  avatarUrl: string;
  avatarHint: string;
  provider: "password" | "google.com";
};

export type ClaimResult =
  | { status: "created"; slot: number; username: string }
  | { status: "exists" };

/**
 * Reserva uma vaga e cria o perfil, numa transação só.
 *
 * - Perfil que já existe: devolve "exists" sem consumir nada (idempotente).
 * - UID que já tem vaga (por exemplo, perfil apagado e recriado): reaproveita
 *   a vaga, sem consumir outra.
 * - Sem vaga e com o limite atingido: resource-exhausted, sem gravar nada.
 * - @ ocupado por outra pessoa: already-exists, sem gravar nada.
 * @param {Firestore} db Banco.
 * @param {ProfileSeed} seed Dados do novo perfil.
 * @param {string[]} candidates @ candidatos, em ordem; vale o primeiro livre.
 * @return {Promise<ClaimResult>} O que aconteceu.
 */
export const claimSlotAndCreateProfile = async (
  db: Firestore,
  seed: ProfileSeed,
  candidates: string[]
): Promise<ClaimResult> => {
  const result = await runClaimTransaction(db, seed, candidates);
  if (result.status === "created") {
    // Uma linha por vaga concedida (sem e-mail nem nome): dá para auditar.
    logger.info(`Signup slot ${result.slot} granted (${seed.provider}).`);
  }
  return result;
};

/**
 * A transação em si (veja claimSlotAndCreateProfile).
 * @param {Firestore} db Banco.
 * @param {ProfileSeed} seed Dados do novo perfil.
 * @param {string[]} candidates @ candidatos, em ordem.
 * @return {Promise<ClaimResult>} O que aconteceu.
 */
const runClaimTransaction = (
  db: Firestore,
  seed: ProfileSeed,
  candidates: string[]
): Promise<ClaimResult> => {
  const controlRef = controlRefOf(db);
  const slotRef = slotRefOf(db, seed.uid);
  const userRef = userRefOf(db, seed.uid);
  return db.runTransaction(async (tx: Transaction): Promise<ClaimResult> => {
    // Todas as leituras antes de qualquer escrita.
    const [userSnap, slotSnap, controlSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(slotRef),
      tx.get(controlRef),
    ]);
    if (userSnap.exists) {
      return {status: "exists"};
    }
    const control = parseControl(controlSnap.data());
    if (!control) {
      throw unavailableError();
    }
    const holdsSlot = slotSnap.exists;
    if (!holdsSlot && control.used >= control.limit) {
      throw closedError(control.limit);
    }

    let chosen: string | null = null;
    for (const candidate of candidates) {
      const taken = await tx.get(
        db.collection("usernames").doc(candidate.toLowerCase())
      );
      if (!taken.exists || taken.get("userId") === seed.uid) {
        chosen = candidate;
        break;
      }
    }
    if (!chosen) {
      throw usernameTakenError();
    }

    // `used` conta apenas pessoas. Como contas da casa/robôs são isentas, o
    // próximo número histórico vem de `issued`, ou repetiria um número já
    // entregue depois da primeira isenção.
    const slot = holdsSlot ?
      Number(slotSnap.get("number")) :
      control.issued + 1;
    if (!holdsSlot) {
      tx.set(slotRef, {
        number: slot,
        provider: seed.provider,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.update(controlRef, {
        used: control.used + 1,
        issued: control.issued + 1,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    tx.set(db.collection("usernames").doc(chosen.toLowerCase()), {
      userId: seed.uid,
    });
    // Cartão público: o que qualquer pessoa vê.
    tx.set(userRef, {
      name: seed.name,
      username: chosen,
      name_lowercase: seed.name.toLowerCase(),
      avatarUrl: seed.avatarUrl,
      "data-ai-hint": seed.avatarHint,
      bio: "",
      followersCount: 0,
      followingCount: 0,
      postsCount: 0,
      dmPreference: "everyone",
      isAdmin: false,
      isModerator: false,
      createdAt: FieldValue.serverTimestamp(),
      coverImageUrl: null,
      "cover-image-ai-hint": null,
      profileVisibility: "public",
      allowTagging: "everyone",
      pinnedPostId: null,
    });
    // Dados pessoais: só o dono (e as Functions) leem.
    tx.set(privateRefOf(db, seed.uid), {
      email: seed.email,
      dateOfBirth: seed.dateOfBirth,
      displaySensitiveContent: false,
      notificationPreferences: {
        likes: true,
        comments: true,
        reposts: true,
        newFollowers: true,
        mentions: true,
        directMessages: true,
      },
      createdAt: FieldValue.serverTimestamp(),
    });
    return {status: "created", slot, username: chosen};
  }, {maxAttempts: TRANSACTION_ATTEMPTS});
};

/**
 * Remove uma conta do Auth, sem nunca derrubar quem chamou.
 * @param {string} uid UID da conta.
 * @return {Promise<void>} Resolve ao terminar (inclusive se falhar).
 */
const removeAuthUser = async (uid: string): Promise<void> => {
  try {
    await getAuth().deleteUser(uid);
  } catch (error) {
    if (errorCode(error) === "auth/user-not-found") {
      return;
    }
    logger.error(
      `CRITICAL: failed to remove orphaned Auth user ${uid}.`,
      error
    );
  }
};

/**
 * Traduz um erro do Auth (Admin SDK) para o que o cliente recebe.
 * @param {unknown} err Erro do Auth.
 * @return {HttpsError} Erro para o cliente.
 */
const authErrorToHttps = (err: unknown): HttpsError => {
  const code = errorCode(err);
  if (
    code === "auth/email-already-exists" ||
    code === "auth/email-already-in-use"
  ) {
    return new HttpsError("already-exists", "This email is already in use.");
  }
  if (code === "auth/invalid-email") {
    return new HttpsError("invalid-argument", "Invalid email address.");
  }
  if (code === "auth/invalid-password") {
    return new HttpsError(
      "invalid-argument",
      "The password must be at least 8 characters long."
    );
  }
  logger.error("Auth error while creating account:", err);
  return new HttpsError("internal", "An internal error occurred.");
};

export type EmailSignupInput = {
  name?: unknown;
  username?: unknown;
  email?: unknown;
  dateOfBirth?: unknown;
  password?: unknown;
};

/**
 * Cadastro por e-mail e senha: confere o limite, cria a conta no Auth e o
 * perfil na transação das vagas. Se a transação falhar, remove a conta nova.
 * @param {Firestore} db Banco.
 * @param {EmailSignupInput} input Dados enviados pelo cliente.
 * @param {{appCheck: boolean}} context A chamada trouxe token válido do App
 *   Check? (só importa quando o anti-robô está ligado no controle)
 * @return {Promise<object>} Status e o perfil criado (do próprio dono).
 */
export const createEmailAccount = async (
  db: Firestore,
  input: EmailSignupInput,
  context: {appCheck: boolean}
) => {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const username = typeof input.username === "string" ? input.username : "";
  const email = typeof input.email === "string" ?
    input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";
  if (!name || name.length > NAME_MAX_LENGTH || !email || !password) {
    throw new HttpsError(
      "invalid-argument",
      "Missing required fields for registration."
    );
  }
  if (!USERNAME_PATTERN.test(username)) {
    throw new HttpsError(
      "invalid-argument",
      "Invalid username format or length."
    );
  }
  if (!isAcceptablePassword(password, email)) {
    throw new HttpsError(
      "invalid-argument",
      "Use uma senha mais forte, com pelo menos 8 caracteres. / " +
        "Use a stronger password with at least 8 characters."
    );
  }
  if (!isAdultBirthDate(input.dateOfBirth)) {
    throw new HttpsError(
      "invalid-argument",
      "Informe uma data válida e confirme ter 18 anos ou mais. / " +
        "Enter a valid date and confirm you are at least 18."
    );
  }
  const dateOfBirth = input.dateOfBirth;

  // Antes de criar qualquer conta: lotado ou @ já usado responde na hora, sem
  // criar (e depois apagar) uma conta no Auth. A transação abaixo confere de
  // novo, e é ela que vale.
  const control = parseControl((await controlRefOf(db).get()).data());
  if (!control) {
    throw unavailableError();
  }
  // Anti-robô: sem token do App Check não cria conta nem consome vaga.
  if (control.requireAppCheck && !context.appCheck) {
    throw appCheckRequiredError();
  }
  if (control.used >= control.limit) {
    throw closedError(control.limit);
  }
  if ((await db.collection("usernames").doc(username.toLowerCase()).get())
    .exists) {
    throw usernameTakenError();
  }

  let record: UserRecord;
  try {
    record = await getAuth().createUser({
      email,
      password,
      displayName: name,
    });
  } catch (error) {
    throw authErrorToHttps(error);
  }

  try {
    await claimSlotAndCreateProfile(
      db,
      {
        uid: record.uid,
        name,
        email: record.email ?? email,
        dateOfBirth,
        avatarUrl: "/profile.png",
        avatarHint: "default profile avatar",
        provider: "password",
      },
      [username]
    );
    await ensureMemberClaim(record);
  } catch (error) {
    // A transação falhou (lotado, @ já usado, Firestore): nada foi gravado, e
    // a conta que acabou de ser criada no Auth sai também (sem usuário órfão).
    // Se o perfil nasceu, não apague por uma falha isolada no claim. A chamada
    // autenticada consegue reparar; apagar dispararia a limpeza de um perfil.
    const profileExists = (await userRefOf(db, record.uid).get()).exists;
    if (!profileExists) await removeAuthUser(record.uid);
    logger.warn(
      `Signup rolled back, Auth user removed (${errorCode(error) ?? "error"}).`
    );
    if (error instanceof HttpsError) {
      throw error;
    }
    logger.error("Error creating profile for new account:", error);
    throw new HttpsError(
      "internal",
      profileExists ?
        "Account created, but membership activation must be retried." :
        "An internal error occurred."
    );
  }

  const [userSnap, privateSnap] = await Promise.all([
    userRefOf(db, record.uid).get(),
    privateRefOf(db, record.uid).get(),
  ]);
  return {
    status: "success",
    user: {id: userSnap.id, ...userSnap.data(), ...privateSnap.data()},
  };
};

/**
 * Candidatos a @ para quem entra pela primeira vez com o Google (o @ final é
 * escolhido depois, na tela de completar o perfil): o nome sem acentos nem
 * símbolos, variações com número e, no fim, um aleatório.
 * @param {string} displayName Nome ou parte do e-mail.
 * @return {string[]} Candidatos, do preferido para o último recurso.
 */
const provisionalUsernames = (displayName: string): string[] => {
  const base = displayName
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 15);
  const root = base.length >= 3 ? base : `user${base}`.slice(0, 15);
  const candidates = [root];
  for (let i = 0; i < 8; i++) {
    candidates.push(`${root.slice(0, 12)}${Math.floor(Math.random() * 1000)}`);
  }
  for (let i = 0; i < 3; i++) {
    candidates.push(`user_${randomBytes(4).toString("hex")}`);
  }
  return candidates;
};

/**
 * Foto da conta Google, só se for um endereço https.
 * @param {string|undefined|null} url Endereço vindo do Auth.
 * @return {string|null} O endereço, ou null.
 */
const safePhotoUrl = (url: string | undefined | null): string | null =>
  typeof url === "string" && /^https:\/\/\S{1,500}$/.test(url) ? url : null;

/**
 * Primeiro acesso com o Google: cria o perfil pela MESMA transação do
 * cadastro por e-mail. Não recebe dado nenhum do cliente: nome, e-mail e foto
 * vêm da conta no Auth. Se o limite estiver atingido, remove a conta que o
 * Google acabou de criar (só se ela não tiver perfil nem vaga).
 * @param {Firestore} db Banco.
 * @param {string} uid UID de quem chamou (já autenticado).
 * @param {string|undefined} signInProvider Provedor do login atual.
 * @param {{appCheck: boolean}} context A chamada trouxe token válido do App
 *   Check? (o anti-robô só vale para quem ainda não tem perfil)
 * @return {Promise<{status: string}>} "created" ou "exists".
 */
export const claimGoogleProfile = async (
  db: Firestore,
  uid: string,
  signInProvider: string | undefined,
  context: {appCheck: boolean}
) => {
  if (signInProvider !== "google.com") {
    throw new HttpsError(
      "permission-denied",
      "Only a Google sign-in can create a profile here."
    );
  }
  // Anti-robô só para perfil NOVO: quem já tem perfil continua entrando mesmo
  // sem token (o ramo "exists" da transação não consome nada).
  if (!context.appCheck) {
    const [profile, slot] = await Promise.all([
      userRefOf(db, uid).get(),
      slotRefOf(db, uid).get(),
    ]);
    if (!profile.exists) {
      try {
        await assertHuman(db, false);
      } catch (error) {
        // O popup do Google cria a conta no Auth antes desta Function. Se a
        // verificação humana recusar um primeiro acesso, remova essa conta
        // recém-criada para não acumular contas só-Auth. Uma vaga histórica
        // preserva a conta de quem já pertenceu ao serviço.
        if (!slot.exists) {
          await removeAuthUser(uid);
          logger.warn(
            "App Check refused new Google account; Auth user removed."
          );
        }
        throw error;
      }
    }
  }
  let record: UserRecord;
  try {
    record = await getAuth().getUser(uid);
  } catch (error) {
    if (errorCode(error) === "auth/user-not-found") {
      throw new HttpsError("unauthenticated", "Account not found.");
    }
    throw error;
  }
  const email = record.email ?? "";
  const nameSource = (record.displayName ?? "").trim() || email.split("@")[0];
  const photo = safePhotoUrl(record.photoURL);

  try {
    const result = await claimSlotAndCreateProfile(
      db,
      {
        uid,
        name: (nameSource || "Novo Usuário").slice(0, NAME_MAX_LENGTH),
        email,
        dateOfBirth: null,
        avatarUrl: photo ?? "/profile.png",
        avatarHint: photo ? "person avatar" : "default profile avatar",
        provider: "google.com",
      },
      provisionalUsernames(nameSource || "user")
    );
    // A claim liga as regras do Storage ao banco Firestore nomeado, que o
    // Storage não consegue consultar diretamente.
    // Depois desta Function o cliente força a renovação do ID token.
    await ensureMemberClaim(await getAuth().getUser(uid));
    return {status: result.status};
  } catch (error) {
    if (
      error instanceof HttpsError &&
      error.code === "resource-exhausted"
    ) {
      // Lotado: a conta que o Google acabou de criar não pode ficar sem
      // perfil. Confere de novo antes de apagar: nunca apaga quem tem perfil.
      const [user, slot] = await Promise.all([
        userRefOf(db, uid).get(),
        slotRefOf(db, uid).get(),
      ]);
      if (!user.exists && !slot.exists) {
        await removeAuthUser(uid);
        logger.warn("Signup closed, new Google account removed from Auth.");
      }
    }
    throw error;
  }
};

/** Atualiza o nascimento depois da mesma validação usada no cadastro. */
export const updateBirthDate = async (
  db: Firestore,
  uid: string,
  value: unknown
): Promise<void> => {
  if (!isAdultBirthDate(value)) {
    throw new HttpsError(
      "invalid-argument",
      "Informe uma data válida de uma pessoa com 18 anos ou mais."
    );
  }
  const [profile, slot] = await Promise.all([
    userRefOf(db, uid).get(),
    slotRefOf(db, uid).get(),
  ]);
  if (!profile.exists || !slot.exists) {
    throw new HttpsError(
      "failed-precondition",
      "Perfil de membro não encontrado."
    );
  }
  await privateRefOf(db, uid).set({
    dateOfBirth: value,
    updatedAt: FieldValue.serverTimestamp(),
  }, {merge: true});
};

/**
 * Repara/renova a claim de membro somente quando perfil e vaga existem.
 * A verificacao dupla impede que uma conta criada diretamente no Auth ganhe
 * permissao de publicar ou enviar arquivos sem passar pelo cadastro limitado.
 * @param {Firestore} db Banco.
 * @param {string} uid UID autenticado.
 * @return {Promise<void>} Resolve depois de gravar (ou confirmar) a claim.
 */
export const refreshMemberClaim = async (
  db: Firestore,
  uid: string
): Promise<void> => {
  const [profile, slot, record] = await Promise.all([
    userRefOf(db, uid).get(),
    slotRefOf(db, uid).get(),
    getAuth().getUser(uid),
  ]);
  if (!profile.exists || !slot.exists) {
    throw new HttpsError(
      "failed-precondition",
      "Perfil de membro nao encontrado."
    );
  }
  await ensureMemberClaim(record);
};
