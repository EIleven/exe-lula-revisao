// src/contexts/VideoQueueContext.tsx
'use client';

import { createContext, useContext } from 'react';
import type { Post } from '@/lib/types';

/**
 * De onde vem a fila do teatro de vídeo: a lista (feed, aba Mídia do perfil...) em que o cartão está. O valor é ESTÁVEL de propósito
 * (`getPosts` lê a lista na hora do toque): se o contexto mudasse a cada página carregada, todos os cartões do feed se redesenhariam.
 */
export type VideoQueueSource = {
  /** O `feedContext` da lista ('profile_media', 'explore', 'following'...). */
  context: string;
  /** Os posts carregados NESTE instante. */
  getPosts: () => readonly Post[];
};

export const VideoQueueContext = createContext<VideoQueueSource | null>(null);

export const useVideoQueueSource = (): VideoQueueSource | null => useContext(VideoQueueContext);

/** Na aba Mídia do perfil o toque no vídeo abre o teatro ali mesmo (a aba É um feed de vídeos); nas demais listas, abre o post. */
export const PROFILE_MEDIA_CONTEXT = 'profile_media';
