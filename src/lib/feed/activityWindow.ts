// src/lib/feed/activityWindow.ts
// A "janela" de uma página de feed: junta as fontes (consultas) e decide até onde é seguro ir, sem pular nem repetir nada.
//
// Cada fonte devolve até `pageSize` itens, do mais novo para o mais antigo. Uma fonte que veio CHEIA pode ter mais coisa mais
// antiga que não veio. Para a fonte cheia, o que é ESTRITAMENTE mais novo que o seu último item veio completo; no próprio instante
// do último item pode faltar empate. Então a "fronteira" é o último instante da fonte cheia mais recente, e só é seguro mostrar o
// que é estritamente mais novo que ela.
//
// DOIS DEFEITOS QUE ISTO FECHA (o `published` do Fediverso tem precisão de segundo; com centenas de contas seguidas, dois posts no
// mesmo segundo são comuns):
//  1. a página cortava no meio de um empate: o item seguinte, com a MESMA data, ficava para trás do cursor e nunca aparecia.
//     Agora a janela nunca corta um empate (pode passar de `limite` em quantos itens empatam no último instante).
//  2. o cursor ficava no instante da fronteira, onde faltavam empates que a fonte cheia não devolveu. Agora a próxima consulta
//     COMEÇA nesse instante (`createdAt < fronteira + 1ms`), e eles chegam inteiros na página seguinte.
//
// O resultado de `proximoLimiteMs` é sempre o limite EXCLUSIVO da consulta seguinte: `createdAt < proximoLimiteMs`.
//
// Sem imports: a lógica é pura e a suíte a exercita sem Firebase.

export type ItemDatado<T> = { time: number; item: T };

export type FonteDeFeed<T> = {
  /** Itens da fonte, do mais novo para o mais antigo. */
  itens: ItemDatado<T>[];
  /** A fonte devolveu o máximo que a consulta permite? Então pode haver mais itens mais antigos. */
  cheia: boolean;
};

export type JanelaDeFeed<T> = {
  /** O que a página mostra, do mais novo para o mais antigo. Pode passar de `limite` para não cortar um empate. */
  janela: ItemDatado<T>[];
  /** Limite exclusivo da consulta seguinte (`createdAt < proximoLimiteMs`), ou `null` se não há mais nada. */
  proximoLimiteMs: number | null;
  temMais: boolean;
};

export function janelaDeAtividades<T>(
  fontes: FonteDeFeed<T>[],
  limite: number,
  elegivel: (item: T) => boolean = () => true,
): JanelaDeFeed<T> {
  let fronteira = -Infinity;
  const todos: ItemDatado<T>[] = [];
  for (const fonte of fontes) {
    todos.push(...fonte.itens);
    if (fonte.cheia && fonte.itens.length > 0) {
      fronteira = Math.max(fronteira, fonte.itens[fonte.itens.length - 1].time);
    }
  }
  todos.sort((a, b) => b.time - a.time);

  // Seguros: estritamente mais novos que a fronteira (no instante dela, a fonte cheia pode não ter devolvido todos os empates).
  const seguros = todos.filter((x) => x.time > fronteira && elegivel(x.item));
  let fim = Math.min(Math.max(limite, 1), seguros.length);
  // Nunca corta no meio de um empate: o que tem a mesma data do último item entra junto.
  while (fim > 0 && fim < seguros.length && seguros[fim].time === seguros[fim - 1].time) fim++;
  const janela = seguros.slice(0, fim);
  const tudoCabe = fim >= seguros.length;

  let proximoLimiteMs: number | null;
  if (!tudoCabe) proximoLimiteMs = janela[janela.length - 1].time; // os empates do último instante já entraram
  else if (fronteira > -Infinity) proximoLimiteMs = fronteira + 1; // a próxima página COMEÇA no instante da fronteira
  else proximoLimiteMs = null;
  return { janela, proximoLimiteMs, temMais: !tudoCabe || fronteira > -Infinity };
}
