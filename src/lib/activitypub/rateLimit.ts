// src/lib/activitypub/rateLimit.ts
// Limitador de janela deslizante, em memória, por chave. Módulo puro (o relógio entra por parâmetro).
//
// HONESTIDADE SOBRE O QUE ISTO É: é um freio por INSTÂNCIA de servidor, não uma garantia global — o App Hosting pode
// ter várias instâncias e cada uma conta sozinha. Serve para a caixa de entrada não ser um canhão apontado para o
// Firestore (ameaça T4, spam e flood): o teto efetivo é `max × instâncias`, e com `maxInstances: 10` isso ainda é
// uma ordem de grandeza abaixo do que derrubaria o banco. O que o limitador NÃO faz é parar um ataque distribuído;
// para isso existem a política de instâncias e o botão de emergência.
//
// (Campos explícitos, sem "parameter properties": o Node, ao rodar os testes, só remove tipos e não compila essa
// sintaxe do TypeScript.)

export type LimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export class WindowLimiter {
  private readonly eventos: Map<string, number[]> = new Map();
  private readonly max: number;
  private readonly janelaMs: number;
  /** Teto de chaves na memória. Acima disso, as mais antigas saem: memória limitada contra chave aleatória. */
  private readonly maxChaves: number;

  constructor(max: number, janelaMs: number, maxChaves = 5000) {
    this.max = max;
    this.janelaMs = janelaMs;
    this.maxChaves = maxChaves;
  }

  take(chave: string, agora: number): LimitResult {
    const inicio = agora - this.janelaMs;
    const lista = (this.eventos.get(chave) ?? []).filter((t) => t > inicio);
    if (lista.length >= this.max) {
      this.eventos.set(chave, lista);
      const maisAntigo = lista[0] ?? agora;
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((maisAntigo + this.janelaMs - agora) / 1000)) };
    }
    lista.push(agora);
    this.eventos.set(chave, lista);
    if (this.eventos.size > this.maxChaves) this.podar(inicio);
    return { ok: true };
  }

  /** Quantas chaves estão sendo rastreadas. Exposto para os testes provarem que a memória é limitada. */
  get tamanho(): number {
    return this.eventos.size;
  }

  private podar(inicio: number): void {
    for (const [chave, lista] of this.eventos) {
      if (lista.length === 0 || lista[lista.length - 1] <= inicio) this.eventos.delete(chave);
    }
    // Ainda acima do teto (todas ativas): descarta as mais antigas na ordem de inserção.
    for (const chave of this.eventos.keys()) {
      if (this.eventos.size <= this.maxChaves) break;
      this.eventos.delete(chave);
    }
  }
}
