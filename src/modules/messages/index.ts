// src/modules/messages/index.ts
// Ponto de entrada modular do subsistema de Mensagens + P2P (WebRTC / E2EE).
// Projetado para funcionar integrado ao HiperVerso ou como app exclusivo de mensagens.

export type { MessagesHostAdapter } from './contracts';
export { defaultStandaloneMessagesHost } from './contracts';
export { MessagesHostProvider, useMessagesHost } from './MessagesHostContext';

// Núcleo P2P (Transporte, Protocolo, Fila Local, Pareamento, Preferências)
export * from '@/lib/p2p/p2pProtocol';
export {
  type P2pPreferences,
  getP2pPreferences,
  saveP2pPreferences,
} from '@/lib/p2p/p2pPreferences';
export * from '@/lib/p2p/p2pLocalStore';
export * from '@/lib/p2p/p2pChannel';
export * from '@/lib/p2p/p2pGroupChannel';
export * from '@/lib/p2p/p2pDevicePairing';
export * from '@/lib/p2p/p2pAccountSwitch';
