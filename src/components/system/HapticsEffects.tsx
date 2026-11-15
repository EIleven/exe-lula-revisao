// src/components/system/HapticsEffects.tsx
'use client';

import { useEffect } from 'react';
import { installTapHaptics } from '@/lib/haptics';

/** Liga o tique leve de vibração em todo toque num controle (veja src/lib/haptics.ts). Não desenha nada. */
export default function HapticsEffects() {
  useEffect(() => installTapHaptics(), []);
  return null;
}
