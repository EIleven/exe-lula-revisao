// Armazenamento em memória que implementa o contrato `FederationStore` (src/lib/activitypub/store.ts).
// Serve aos testes dos serviços da federação: rápido, determinístico e sem emulador. O adaptador do Firestore é
// testado à parte, contra o emulador, com as mesmas expectativas.
//
// Os dados são copiados na entrada e na saída (structuredClone): um teste que mutasse o objeto devolvido e, por
// acaso, alterasse o "banco" esconderia defeito de verdade, porque o Firestore nunca devolve a mesma referência.

const copia = (v) => (v === undefined ? v : structuredClone(v));

export function createMemoryStore(inicial = {}) {
  const platform = { enabled: true, killSwitch: false, mode: 'open', ...inicial.platform };
  let policy = { mode: 'open', rules: {}, ...inicial.policy };

  const handles = new Map();
  const accounts = new Map();
  const keys = new Map();
  const profiles = new Map();
  const posts = new Map();
  const objects = new Map();
  const followers = new Map(); // `${uid}|${actorId}`
  const remoteActors = new Map();
  const seen = new Map();
  const blocks = new Map(); // uid -> []
  const jobs = new Map();
  const deliveries = new Map();
  const health = new Map();
  const leases = new Map(); // id -> até quando
  const auditoria = [];
  const contadores = new Map();
  const contadoresPorDia = new Map(); // yyyymmdd -> { nome: n }
  const agoraMs = inicial.now ?? (() => 0);
  const diaDe = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`; };
  const flags = [];
  // interações federadas
  const comments = new Map(); // `${postId}/${commentId}` -> LocalComment
  const likes = new Map(); // `post:${postId}|${actorId}` ou `comment:${postId}/${commentId}|${actorId}` -> activityId
  const boosts = new Map();
  const outboundFollows = new Map(); // `${uid}|${actorId}` -> { status }
  const remotePosts = new Map(); // apObjectId -> { postId, actorId, text, isDeleted }
  const remoteComments = new Map(); // apObjectId -> { postId, commentId, actorId, text }
  const ingeridos = []; // o que o inbox mandou guardar (Create/Announce de terceiros)

  const store = {
    // ── configuração ──
    async getPlatform() { return copia(platform); },
    async getInstancePolicy() { return copia(policy); },
    async setPlatform(patch) {
      if (typeof patch.enabled === 'boolean') platform.enabled = patch.enabled;
      if (typeof patch.killSwitch === 'boolean') platform.killSwitch = patch.killSwitch;
      if (patch.mode === 'open' || patch.mode === 'allowlist') platform.mode = patch.mode;
      policy = { ...policy, mode: platform.mode };
    },
    async setInstanceRule(dominio, action) {
      const rules = { ...policy.rules };
      if (action === null) delete rules[dominio];
      else rules[dominio] = { action };
      policy = { ...policy, rules };
    },

    // ── contas e handles ──
    async getHandle(h) { return copia(handles.get(h) ?? null); },
    async getAccount(uid) { return copia(accounts.get(uid) ?? null); },
    async createHandleIfAbsent(r) {
      if (handles.has(r.handle)) return false;
      handles.set(r.handle, copia(r));
      return true;
    },
    async putHandle(r) { handles.set(r.handle, copia(r)); },
    async setHandleState(h, state) {
      const r = handles.get(h);
      if (r) handles.set(h, { ...r, state });
    },
    async saveAccount(r) { accounts.set(r.uid, copia(r)); },
    async findHandleByUid(uid) {
      for (const r of handles.values()) if (r.uid === uid) return copia(r);
      return null;
    },
    async listHandlesWithKeyDue(agora, limite) {
      return [...handles.values()].filter((r) => r.keyDeleteAfterMs !== null && r.keyDeleteAfterMs <= agora).slice(0, limite).map(copia);
    },

    // ── chaves ──
    async saveSealedKey(uid, s) { keys.set(uid, copia(s)); },
    async saveSealedKeyIfAbsent(uid, s) {
      if (keys.has(uid)) return false;
      keys.set(uid, copia(s));
      return true;
    },
    async loadSealedKey(uid) { return copia(keys.get(uid) ?? null); },
    async deleteKey(uid) { keys.delete(uid); },

    // ── conteúdo local ──
    async getProfile(uid) { return copia(profiles.get(uid) ?? null); },
    async getPost(id) { return copia(posts.get(id) ?? null); },
    async getObject(id) { return copia(objects.get(id) ?? null); },
    async putObject(r) { objects.set(r.postId, copia(r)); },
    async listPublicObjects(uid, before, limite) {
      return [...objects.values()]
        .filter((o) => o.uid === uid && o.scope === 'public' && o.state === 'federated' && (before === null || o.createdAtMs < before))
        .sort((a, b) => b.createdAtMs - a.createdAtMs)
        .slice(0, limite)
        .map(copia);
    },
    async countPublicObjects(uid) {
      return [...objects.values()].filter((o) => o.uid === uid && o.scope === 'public' && o.state === 'federated').length;
    },
    async federationCounts() {
      return {
        accounts: [...accounts.values()].filter((a) => a.enabled).length,
        publicObjects: [...objects.values()].filter((o) => o.scope === 'public' && o.state === 'federated').length,
      };
    },

    // ── seguidores ──
    async getFollower(uid, actorId) { return copia(followers.get(`${uid}|${actorId}`) ?? null); },
    async putFollower(r) { followers.set(`${r.uid}|${r.actorId}`, copia(r)); },
    async deleteFollower(uid, actorId) { return followers.delete(`${uid}|${actorId}`); },
    async findFollowersByActor(actorId) { return [...followers.values()].filter((f) => f.actorId === actorId).map(copia); },
    async listFollowers(uid, limite, depois) {
      const todos = [...followers.values()].filter((f) => f.uid === uid).sort((a, b) => (a.actorId < b.actorId ? -1 : 1));
      const inicio = depois === null ? 0 : todos.findIndex((f) => f.actorId === depois) + 1;
      return todos.slice(inicio, inicio + limite).map(copia);
    },
    async countFollowers(uid) { return [...followers.values()].filter((f) => f.uid === uid).length; },

    // ── atores remotos ──
    async getRemoteActor(id) { return copia(remoteActors.get(id) ?? null); },
    async putRemoteActor(r) { remoteActors.set(r.actorId, copia(r)); },

    // ── idempotência ──
    async markSeen(id, ttl) {
      if (seen.has(id)) return false;
      seen.set(id, ttl);
      return true;
    },

    // ── saída da federação ──
    async purgeUserData(uid) {
      for (const [id, o] of objects) if (o.uid === uid) objects.delete(id);
      blocks.delete(uid);
    },

    // ── bloqueios ──
    async listUserBlocks(uid) { return copia(blocks.get(uid) ?? []); },
    // Idempotente por (escopo, valor), como no Firestore, onde o id do documento é derivado deles.
    async addUserBlock(uid, b) {
      const atual = blocks.get(uid) ?? [];
      if (atual.some((x) => x.scope === b.scope && x.value === b.value)) return;
      blocks.set(uid, [...atual, copia(b)]);
    },
    async removeUserBlock(uid, b) {
      blocks.set(uid, (blocks.get(uid) ?? []).filter((x) => !(x.scope === b.scope && x.value === b.value)));
    },

    // ── fila ──
    async enqueueJob(j) { jobs.set(j.id, copia(j)); },
    async claimDueJobs(agora, limite, lease) {
      const devidos = [...jobs.values()]
        .filter((j) => j.state === 'pending' && j.nextAttemptAt !== null && j.nextAttemptAt <= agora && (leases.get(`j:${j.id}`) ?? 0) <= agora)
        .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
        .slice(0, limite);
      for (const j of devidos) leases.set(`j:${j.id}`, agora + lease);
      return devidos.map(copia);
    },
    async finishJob(id, state, note) {
      const j = jobs.get(id);
      if (j) jobs.set(id, { ...j, state, note, nextAttemptAt: null });
      leases.delete(`j:${id}`);
    },
    async putDeliveryIfAbsent(r) {
      if (deliveries.has(r.id)) return false;
      deliveries.set(r.id, copia(r));
      return true;
    },
    async claimDueDeliveries(agora, limite, lease) {
      const devidas = [...deliveries.values()]
        .filter((d) => d.status === 'pending' && d.nextAttemptAt !== null && d.nextAttemptAt <= agora && (leases.get(`d:${d.id}`) ?? 0) <= agora)
        .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
        .slice(0, limite);
      for (const d of devidas) leases.set(`d:${d.id}`, agora + lease);
      return devidas.map(copia);
    },
    async updateDelivery(id, patch) {
      const d = deliveries.get(id);
      if (d) deliveries.set(id, { ...d, ...copia(patch) });
      leases.delete(`d:${id}`);
    },
    async listDeliveries(uid, limite) {
      return [...deliveries.values()].filter((d) => d.uid === uid).sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, limite).map(copia);
    },
    async getDelivery(id) { return copia(deliveries.get(id) ?? null); },
    async getDomainHealth(d) { return copia(health.get(d) ?? null); },
    async setDomainHealth(h) { health.set(h.domain, copia(h)); },
    async queueDepth() {
      return {
        jobs: [...jobs.values()].filter((j) => j.state === 'pending').length,
        deliveries: [...deliveries.values()].filter((d) => d.status === 'pending').length,
        dead: [...deliveries.values()].filter((d) => d.status === 'dead').length,
      };
    },

    // ── observabilidade ──
    async audit(e) { auditoria.push(copia(e)); },
    async bump(nome, por = 1) {
      contadores.set(nome, (contadores.get(nome) ?? 0) + por);
      const dia = diaDe(agoraMs());
      const doDia = contadoresPorDia.get(dia) ?? {};
      doDia[nome] = (doDia[nome] ?? 0) + por;
      contadoresPorDia.set(dia, doDia);
    },
    async readCounters(dia) { return copia(contadoresPorDia.get(dia) ?? {}); },
    async saveFlag(f) { flags.push(copia(f)); },

    // ── interações federadas ──
    async getComment(postId, commentId) { return copia(comments.get(`${postId}/${commentId}`) ?? null); },
    async recordRemoteLike(postId, actor, activityId) {
      const p = posts.get(postId);
      if (!p || p.isDeleted) return 'missing-post';
      const k = `post:${postId}|${actor.actorId}`;
      if (likes.has(k)) return 'duplicate';
      likes.set(k, activityId);
      return 'added';
    },
    async removeRemoteLike(postId, actorId) { return likes.delete(`post:${postId}|${actorId}`); },
    async recordRemoteBoost(postId, actor, activityId) {
      const p = posts.get(postId);
      if (!p || p.isDeleted) return 'missing-post';
      const k = `post:${postId}|${actor.actorId}`;
      if (boosts.has(k)) return 'duplicate';
      boosts.set(k, activityId);
      return 'added';
    },
    async removeRemoteBoost(postId, actorId) { return boosts.delete(`post:${postId}|${actorId}`); },
    async recordRemoteCommentLike(postId, commentId, actor, activityId) {
      const c = comments.get(`${postId}/${commentId}`);
      if (!c || c.isDeleted) return 'missing-comment';
      const k = `comment:${postId}/${commentId}|${actor.actorId}`;
      if (likes.has(k)) return 'duplicate';
      likes.set(k, activityId);
      return 'added';
    },
    async removeRemoteCommentLike(postId, commentId, actorId) { return likes.delete(`comment:${postId}/${commentId}|${actorId}`); },
    async recordRemoteCommentBoost(postId, commentId, actor, activityId) {
      const c = comments.get(`${postId}/${commentId}`);
      if (!c || c.isDeleted) return 'missing-comment';
      const k = `comment:${postId}/${commentId}|${actor.actorId}`;
      if (boosts.has(k)) return 'duplicate';
      boosts.set(k, activityId);
      return 'added';
    },
    async removeRemoteCommentBoost(postId, commentId, actorId) { return boosts.delete(`comment:${postId}/${commentId}|${actorId}`); },
    async recordRemoteComment(input) {
      const p = posts.get(input.postId);
      if (!p || p.isDeleted) return 'missing-post';
      if (remoteComments.has(input.apObjectId)) return 'duplicate';
      const commentId = `ap_${remoteComments.size + 1}`;
      remoteComments.set(input.apObjectId, { postId: input.postId, commentId, actorId: input.actor.actorId, text: input.text });
      comments.set(`${input.postId}/${commentId}`, { id: commentId, postId: input.postId, userId: `ap_${input.actor.actorId}`, text: input.text, createdAtMs: input.createdAtMs, parentCommentId: input.parentCommentId ?? null, isDeleted: false, sensitive: false, isRemoteFediverse: true });
      return 'added';
    },
    async removeRemoteComment(apObjectId, actorId) {
      const m = remoteComments.get(apObjectId);
      if (!m || m.actorId !== actorId) return false;
      comments.delete(`${m.postId}/${m.commentId}`);
      remoteComments.delete(apObjectId);
      return true;
    },
    // quem o nosso pessoal segue no Fediverso: `hasRemoteFollowers` é "alguém daqui segue este ator"
    async hasRemoteFollowers(actorId) { return [...outboundFollows.keys()].some((k) => k.endsWith(`|${actorId}`)); },
    async hasPost(postId) { const p = posts.get(postId); return Boolean(p) && !p.isDeleted; },
    async ingestRemotePost(input) {
      if (!(await store.hasRemoteFollowers(input.actor.actorId))) return 'no-followers';
      if (remotePosts.has(input.apObjectId)) return 'duplicate';
      remotePosts.set(input.apObjectId, { postId: `ap_p${remotePosts.size + 1}`, actorId: input.actor.actorId, text: input.text, isDeleted: false });
      ingeridos.push({ tipo: 'post', apObjectId: input.apObjectId, actorId: input.actor.actorId });
      return 'added';
    },
    async ingestRemoteAnnounce(input) {
      if (!(await store.hasRemoteFollowers(input.booster.actorId))) return 'no-followers';
      ingeridos.push({ tipo: 'announce', apObjectId: input.apObjectId, boosterId: input.booster.actorId, autorId: input.author?.actorId ?? null });
      return 'added';
    },
    async acceptOutboundFollow(uid, actorId) {
      const k = `${uid}|${actorId}`;
      if (!outboundFollows.has(k)) return false;
      outboundFollows.set(k, { status: 'accepted' });
      return true;
    },
    async rejectOutboundFollow(uid, actorId) { return outboundFollows.delete(`${uid}|${actorId}`); },
    async updateRemoteContent(apObjectId, actorId, texto) {
      const c = remoteComments.get(apObjectId);
      if (c && c.actorId === actorId) { c.text = texto; const x = comments.get(`${c.postId}/${c.commentId}`); if (x) x.text = texto; return 'comment'; }
      const p = remotePosts.get(apObjectId);
      if (p && p.actorId === actorId && !p.isDeleted) { p.text = texto; return 'post'; }
      return 'unknown';
    },
    async removeRemotePost(apObjectId, actorId) {
      const p = remotePosts.get(apObjectId);
      if (!p || p.actorId !== actorId || p.isDeleted) return false;
      p.isDeleted = true;
      p.text = '[Post removido na origem]';
      return true;
    },
    async removeRemoteActorContent(actorId) {
      let n = 0;
      for (const p of remotePosts.values()) if (p.actorId === actorId && !p.isDeleted) { p.isDeleted = true; n++; }
      return n;
    },
  };

  // Ajudas só dos testes: semear e inspecionar o "banco" sem passar pelo contrato.
  const teste = {
    platform,
    setPolicy(p) { policy = { mode: 'open', rules: {}, ...p }; },
    seedProfile(p) { profiles.set(p.uid, copia(p)); },
    seedPost(p) { posts.set(p.id, copia(p)); },
    removePost(id) { posts.delete(id); },
    patchPost(id, patch) { posts.set(id, { ...posts.get(id), ...patch }); },
    audit: auditoria,
    contadores,
    flags,
    deliveries,
    jobs,
    followers,
    handles,
    accounts,
    keys,
    remoteActors,
    objects,
    seen,
    leases,
    health,
    expirarPosse() { leases.clear(); },
    comments, likes, boosts, outboundFollows, remotePosts, remoteComments, ingeridos, posts,
    seedComment(c) { comments.set(`${c.postId}/${c.id}`, { isDeleted: false, sensitive: false, parentCommentId: null, createdAtMs: 0, text: '', ...copia(c) }); },
    seedOutboundFollow(uid, actorId, status = 'pending') { outboundFollows.set(`${uid}|${actorId}`, { status }); },
    seedRemotePost(p) { remotePosts.set(p.apObjectId, { postId: p.postId ?? 'ap_x', actorId: p.actorId, text: p.text ?? '', isDeleted: false }); },
  };
  return { store, teste };
}
