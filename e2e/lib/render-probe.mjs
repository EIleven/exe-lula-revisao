/**
 * Sonda de renderizações do React para os testes: um "gancho" do DevTools do React injetado ANTES do app, só no navegador de
 * teste (nada no app), que conta quantos commits aconteceram e quantos componentes foram redesenhados neles.
 *
 *   await context.addInitScript(installRenderProbe);
 *   await startRenderProbe(page);   // zera e liga a contagem
 *   ... rolar, tocar, esperar um evento externo ...
 *   const { commits, components, biggest } = await stopRenderProbe(page);
 *
 * Serve para provar que algo NÃO redesenha o feed (rolar a tela, um seguidor novo, uma notificação): num feed de 60 cartões,
 * cada commit que o tocava redesenhava milhares de componentes.
 */

/** Roda NO NAVEGADOR (addInitScript serializa esta função): não use nada do módulo aqui dentro. */
export function installRenderProbe() {
  const probe = (window.__renderProbe = { on: false, commits: 0, components: 0, sizes: [], names: {} });
  // 0 = função, 11 = forwardRef, 15 = função simples dentro de React.memo
  const isFunctionComponent = (tag) => tag === 0 || tag === 11 || tag === 15;
  const count = (next, prev) => {
    const rendered = isFunctionComponent(next.tag) && (next.flags & 1);
    let n = rendered ? 1 : 0;
    if (rendered) {
      const type = next.type ?? next.elementType;
      const name = type?.displayName ?? type?.name ?? `tag:${next.tag}`;
      probe.names[name] = (probe.names[name] ?? 0) + 1;
    }
    if (!prev || next.child !== prev.child) {
      for (let child = next.child; child; child = child.sibling) n += count(child, child.alternate);
    }
    return n;
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject(renderer) { const id = this.renderers.size + 1; this.renderers.set(id, renderer); return id; },
    onCommitFiberRoot(_id, root) {
      if (!probe.on) return;
      const n = count(root.current, root.current.alternate);
      probe.commits += 1;
      probe.components += n;
      probe.sizes.push(n);
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onScheduleFiberRoot() {},
    checkDCE() {},
  };
}

export const startRenderProbe = (page) => page.evaluate(() => {
  const probe = window.__renderProbe;
  probe.on = true; probe.commits = 0; probe.components = 0; probe.sizes = []; probe.names = {};
});

export const stopRenderProbe = (page) => page.evaluate(() => {
  const probe = window.__renderProbe;
  probe.on = false;
  const top = Object.entries(probe.names).sort((a, b) => b[1] - a[1]).slice(0, 12);
  return { commits: probe.commits, components: probe.components, biggest: Math.max(0, ...probe.sizes), top };
});
