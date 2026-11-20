// src/lib/messages/entradaEmGrupo.ts
// QUEM PODE SER COLOCADO NUM GRUPO. Módulo PURO (sem React, sem Firebase, sem DOM): os sinais da relação entram por
// parâmetro, para a suíte exercitar cada caminho em Node.
//
// O que estava errado: a conversa 1:1 já respeitava a escolha do outro lado -- `isValidNewConversation`, nas regras,
// recusa quando `dmPreference` é 'none', exige seguimento quando é 'followed' e barra bloqueio nos DOIS sentidos.
// Grupo não checava nada. Ou seja: quem fechou a caixa de entrada, ou bloqueou alguém, podia ser jogado por essa
// mesma pessoa numa sala com centenas de desconhecidos. A porta dos fundos era mais larga que a da frente.
//
// E grupo expõe MAIS que DM, não menos: ali a sua mensagem alcança todo mundo da sala, e o seu nome aparece na lista
// para todos. Então a trava do grupo tem de ser no mínimo tão estrita quanto a do 1:1 -- é a mesma tabela, de
// propósito, para não existirem duas verdades sobre consentimento.
//
// LIMITE HONESTO: este módulo roda no cliente. Ele fecha o caminho normal do aplicativo, não uma chamada forjada
// direto no Firestore. A trava que vale contra isso é a das regras, que precisa da guarda equivalente.

/** Os valores que a interface oferece. Qualquer outra coisa é tratada como 'everyone', igual ao `get(...,'everyone')` da regra. */
export type PreferenciaDeDm = 'everyone' | 'followed' | 'none';

/**
 * Os sinais da relação entre quem adiciona (ATOR) e quem seria adicionado (ALVO).
 *
 * Todos os quatro são obteníveis pelo cliente sem furar regra nenhuma:
 *   · `dmPreference`       -> campo do documento público do alvo
 *   · `alvoBloqueouOAtor`  -> `users/{alvo}/blockedUsers/{ator}`, que a regra libera justamente para o bloqueado
 *   · `atorBloqueouOAlvo`  -> lista de bloqueados do próprio ator
 *   · `alvoSegueOAtor`     -> `users/{alvo}/following/{ator}`, legível por quem está autenticado
 */
export type SinaisDaRelacao = {
  dmPreference?: PreferenciaDeDm | string | null;
  /** O ALVO segue o ATOR? É este o sentido que 'followed' cobra -- "só recebo de quem eu sigo". */
  alvoSegueOAtor?: boolean;
  alvoBloqueouOAtor?: boolean;
  atorBloqueouOAlvo?: boolean;
  /** Conta do Fediverso: não tem `dmPreference` guardada aqui. Dispensa a preferência, NUNCA o bloqueio. */
  ehRemoto?: boolean;
};

export type MotivoDaRecusa = 'bloqueio' | 'caixa-fechada' | 'so-quem-ela-segue';

export type Veredito = { entra: true } | { entra: false; motivo: MotivoDaRecusa };

/** O que dizer à pessoa que tentou adicionar. Sem revelar qual dos dois lados bloqueou: isso é dado de quem bloqueou. */
export const MOTIVO_EM_PALAVRAS: Record<MotivoDaRecusa, string> = {
  bloqueio: 'não pode ser adicionada por você',
  'caixa-fechada': 'não aceita ser adicionada a grupos',
  'so-quem-ela-segue': 'só aceita de quem ela segue',
};

/**
 * 'none' e 'followed' travam; o resto vale como 'everyone' -- igual ao `get(...,'everyone')` da regra.
 *
 * Com UMA correção deliberada em relação à regra de hoje: 'nobody' é valor LEGADO que ainda existe em documentos
 * antigos (a rota do admin da conta oficial repara 'nobody' -> 'none' justamente por isso). A regra do 1:1 compara
 * com 'none' literal, então 'nobody' passa por lá: quem fechou a caixa antes da troca de nome voltou a ser alcançável
 * sem saber. Aqui ele conta como 'none'. Não se copia o buraco em nome de "uma verdade só" -- é a regra que precisa
 * acompanhar.
 */
function preferenciaDe(v: SinaisDaRelacao['dmPreference']): PreferenciaDeDm {
  if (v === 'none' || v === 'nobody') return 'none';
  return v === 'followed' ? 'followed' : 'everyone';
}

/**
 * A decisão. Bloqueio é testado PRIMEIRO e nos dois sentidos: é a única escolha que não admite exceção por tipo de
 * conta, e quem bloqueou não deve nem aparecer como adicionável.
 */
export function podeEntrarNoGrupo(sinais: SinaisDaRelacao): Veredito {
  if (sinais.alvoBloqueouOAtor === true || sinais.atorBloqueouOAlvo === true) {
    return { entra: false, motivo: 'bloqueio' };
  }
  if (sinais.ehRemoto === true) return { entra: true };

  const pref = preferenciaDe(sinais.dmPreference);
  if (pref === 'none') return { entra: false, motivo: 'caixa-fechada' };
  if (pref === 'followed' && sinais.alvoSegueOAtor !== true) {
    return { entra: false, motivo: 'so-quem-ela-segue' };
  }
  return { entra: true };
}

/** Atalho para quem só precisa do sim/não. */
export const entraNoGrupo = (sinais: SinaisDaRelacao): boolean => podeEntrarNoGrupo(sinais).entra;

/**
 * Triagem de uma lista. Devolve os aceitos E os recusados com o motivo -- porque sumir com a pessoa da lista sem
 * dizer nada é o comportamento que faz alguém achar que o aplicativo está quebrado.
 */
export function triarEntradas<T>(
  candidatos: T[],
  sinaisDe: (candidato: T) => SinaisDaRelacao,
): { aceitos: T[]; recusados: Array<{ candidato: T; motivo: MotivoDaRecusa }> } {
  const aceitos: T[] = [];
  const recusados: Array<{ candidato: T; motivo: MotivoDaRecusa }> = [];
  for (const candidato of candidatos) {
    const v = podeEntrarNoGrupo(sinaisDe(candidato));
    if (v.entra) aceitos.push(candidato);
    else recusados.push({ candidato, motivo: v.motivo });
  }
  return { aceitos, recusados };
}
