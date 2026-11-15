import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Vibração leve de um toque. Mantida por compatibilidade com quem já chamava: agora usa a camada de src/lib/haptics.ts
 * (motor nativo no app Android, Vibration API no navegador, respeitando a opção de desligar nas Configurações).
 */
export function triggerHapticFeedback() {
  // Import tardio: utils é importado em todo o app e a vibração só importa depois do primeiro toque.
  void import("./haptics").then((module) => module.haptics.tap());
}

