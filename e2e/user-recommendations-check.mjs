#!/usr/bin/env node
/** Verifica a ordenação pura das sugestões sem Firebase nem dados reais. */
const { rankUserRecommendations } = await import('../src/lib/recommendations/userRecommendations.ts');

let total = 0;
let failures = 0;
const check = (name, condition, detail = '') => {
  total++;
  if (condition) console.log(`OK    ${name}`);
  else {
    failures++;
    console.log(`FALHA ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const signal = (userId, changes = {}) => ({
  userId,
  followsViewer: false,
  mutualCount: 0,
  affinityByTopic: {},
  recentPosts: 0,
  followersCount: 0,
  postsCount: 0,
  profileComplete: false,
  ...changes,
});

{
  const ranked = rankUserRecommendations([
    signal('popular', { followersCount: 1_000_000, postsCount: 500 }),
    signal('reciprocal', { followsViewer: true }),
  ], 2);
  check('quem já segue a pessoa vem antes de uma conta apenas popular', ranked[0].userId === 'reciprocal');
  check('a reciprocidade é explicada na interface', ranked[0].reason.kind === 'follows-you');
}

{
  const ranked = rankUserRecommendations([
    signal('popular', { followersCount: 1_000_000 }),
    signal('network', { mutualCount: 2 }),
  ], 2);
  check('conexões em comum pesam mais que popularidade bruta', ranked[0].userId === 'network');
  check('o número de conexões em comum é preservado no motivo', ranked[0].reason.kind === 'mutual' && ranked[0].reason.count === 2);
}

{
  const ranked = rankUserRecommendations([
    signal('cinema', { affinityByTopic: { Cinema: 18 }, recentPosts: 2 }),
    signal('generic', { recentPosts: 4 }),
  ], 2);
  check('afinidade real de assunto melhora a posição', ranked[0].userId === 'cinema');
  check('o assunto que justificou a sugestão é mostrado', ranked[0].reason.kind === 'interest' && ranked[0].reason.topic === 'Cinema');
}

{
  const ranked = rankUserRecommendations([
    signal('z-user', { recentPosts: 1 }),
    signal('a-user', { recentPosts: 1 }),
    signal('inactive'),
  ], 2);
  check('atividade recente é um fallback melhor que perfil inativo', ranked.every((item) => item.recentPosts === 1));
  check('empates são estáveis por id e o limite é respeitado', ranked.length === 2 && ranked[0].userId === 'a-user');
}

console.log(`\n${total - failures} de ${total} verificações passaram.`);
process.exit(failures ? 1 : 0);
