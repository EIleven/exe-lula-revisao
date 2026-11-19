// src/lib/haptics.ts
// Vibração leve nas ações da pessoa, no app Android (motor do celular, pelo plugin nativo) e no navegador do celular
// (Vibration API, que o Chrome do Android e o WebView do app oferecem; o iPhone não oferece e nada acontece).
//
// Princípios: sutil (ticks curtos, nunca contínuo), só em resposta a um toque da pessoa, desligável nas Configurações, e
// sem dobrar: se uma ação já vibrou de forma específica (curtir, enviar), o tique genérico do toque não repete.

export type HapticKind = 'tap' | 'select' | 'like' | 'success' | 'warning' | 'error';

const STORAGE_KEY = 'exelula:haptics';
/** Intervalo mínimo entre duas vibrações (evita picotar quando vários eventos vêm juntos). */
const MIN_GAP_MS = 35;

// Padrões do navegador, em milissegundos [liga, desliga, liga...]. Durações curtas, mas acima do mínimo que o motor do
// celular reproduz de verdade: abaixo de ~10 ms muitos aparelhos (inclusive Samsung) nem chegam a vibrar.
const WEB_PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 14,
  select: 10,
  like: [10, 40, 16],
  success: [12, 50, 12],
  warning: [24, 60, 24],
  error: [30, 50, 30, 50, 30],
};

let lastFiredAt = 0;
let nativeHaptics: typeof import('@capacitor/haptics') | null | undefined;

/** A vibração está ligada? (padrão: sim; a pessoa pode desligar em Configurações). */
export function isHapticsEnabled(): boolean {
  try {
    return typeof localStorage === 'undefined' || localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true; // sem localStorage: segue o padrão
  }
}

export function setHapticsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch { /* sem localStorage: vale só até recarregar */ }
  if (enabled) haptics.select(); // a pessoa sente na hora o que acabou de ligar
}

/** O aparelho consegue vibrar? (para mostrar ou esconder a opção nas Configurações). */
export function isHapticsSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (cap?.isNativePlatform?.()) return true;
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function' && (navigator.maxTouchPoints ?? 0) > 0;
}

async function loadNative(): Promise<typeof import('@capacitor/haptics') | null> {
  if (nativeHaptics !== undefined) return nativeHaptics;
  nativeHaptics = null;
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Haptics')) {
      nativeHaptics = await import('@capacitor/haptics');
    }
  } catch { /* sem plugin: usa a Vibration API */ }
  return nativeHaptics;
}
// Aquece já na carga (só no navegador): o primeiro toque não espera o import.
if (typeof window !== 'undefined') void loadNative();

function viaWeb(kind: HapticKind): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(WEB_PATTERNS[kind]);
  } catch { /* o navegador recusou (sem toque recente): ignora */ }
}

function fire(kind: HapticKind): void {
  if (typeof window === 'undefined' || !isHapticsEnabled()) return;
  const now = performance.now();
  if (now - lastFiredAt < MIN_GAP_MS) return;
  lastFiredAt = now;
  const native = nativeHaptics;
  if (!native) {
    viaWeb(kind);
    return;
  }
  const { Haptics, ImpactStyle, NotificationType } = native;
  const run = (): Promise<void> => {
    switch (kind) {
      case 'success': return Haptics.notification({ type: NotificationType.Success });
      case 'warning': return Haptics.notification({ type: NotificationType.Warning });
      case 'error': return Haptics.notification({ type: NotificationType.Error });
      case 'like': return Haptics.impact({ style: ImpactStyle.Medium });
      case 'select': return Haptics.impact({ style: ImpactStyle.Light });
      default: return Haptics.impact({ style: ImpactStyle.Light });
    }
  };
  run().catch(() => viaWeb(kind));
}

export const haptics = {
  /** Toque simples em botão, menu, aba ou interruptor. */
  tap: () => fire('tap'),
  /** Mudança de seleção (aba, filtro, ligar ou desligar uma opção). */
  select: () => fire('select'),
  /** Curtir ou repostar: um pouco mais marcado que o toque. */
  like: () => fire('like'),
  /** Algo deu certo e terminou (publicou, enviou, seguiu). */
  success: () => fire('success'),
  /** Ação que pede cuidado (apagar, bloquear). */
  warning: () => fire('warning'),
  /** Algo deu errado. */
  error: () => fire('error'),
};

/** Momento da última vibração (para o tique genérico não repetir uma ação que já vibrou). */
export function lastHapticAt(): number {
  return lastFiredAt;
}

const TAPPABLE = 'button, a[href], [data-interactive="true"], [role="button"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], summary, input[type="checkbox"], input[type="radio"], [data-haptic]';

/**
 * Tique leve em TODO toque num controle (botão, item de menu, aba, interruptor), como nos aplicativos nativos. Só toque e
 * caneta (mouse não vibra), só no clique (rolar a tela por cima de um botão não vibra) e sem repetir o que uma ação
 * específica já vibrou. Marque `data-no-haptic` num container para excluí-lo. Devolve a função que remove o ouvinte.
 */
export function installTapHaptics(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  let downAt = -1;
  const onDown = (event: PointerEvent) => {
    downAt = event.pointerType === 'touch' || event.pointerType === 'pen' ? performance.now() : -1;
  };
  const onClick = (event: MouseEvent) => {
    const started = downAt;
    downAt = -1;
    if (started < 0 || performance.now() - started > 1500) return;
    // Uma vibração específica (curtir, enviar...) já saiu desde que o dedo encostou: não repete.
    if (lastFiredAt >= started) return;
    const target = event.target instanceof Element ? event.target.closest(TAPPABLE) : null;
    if (!target || target.closest('[data-no-haptic]')) return;
    if ((target as HTMLButtonElement).disabled || target.getAttribute('aria-disabled') === 'true') return;
    haptics.tap();
  };
  document.addEventListener('pointerdown', onDown, { capture: true, passive: true });
  document.addEventListener('click', onClick, { capture: true });
  return () => {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('click', onClick, true);
  };
}
