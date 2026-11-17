// src/modules/messages/contracts.ts
import type React from 'react';

/**
 * Contrato de desacoplamento entre o núcleo de Mensagens + P2P (WebRTC/E2EE)
 * e o aplicativo hospedeiro (HiperVerso completo hoje, ou app exclusivo de mensagens amanhã).
 *
 * Mantém zero dependência obrigatória com Feed, Posts, Tendências ou Painel Admin.
 */
export interface MessagesHostAdapter {
  /** Renderiza a prévia de um post compartilhado dentro de uma bolha de mensagem (opcional em modo standalone). */
  renderSharedPost?: (postId: string, locale: string) => React.ReactNode;
  /** Publica convite de grupo na rede social hospedeira (opcional em modo standalone). */
  publishGroupInvite?: (params: {
    userId: string;
    text: string;
    groupId: string;
  }) => Promise<void>;
  /** Constrói o caminho para abrir o perfil de um contato. */
  getProfileHref: (userId: string, locale: string) => string;
  /** Constrói o caminho para abrir um post compartilhado. */
  getPostHref: (postId: string, locale: string) => string;
}

export const defaultStandaloneMessagesHost: MessagesHostAdapter = {
  getProfileHref: (userId, locale) => `/${locale}/profile/${userId}`,
  getPostHref: (postId, locale) => `/${locale}/post/${postId}`,
};

