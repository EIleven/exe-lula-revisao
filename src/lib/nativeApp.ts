// src/lib/nativeApp.ts
// Detecta se o site está rodando DENTRO do app Android (WebView do Capacitor). A ponte nativa injeta window.Capacitor,
// inclusive em páginas carregadas por server.url. Usado para não oferecer "instalar o app" a quem já está nele e para
// escolher o login nativo do Google (o popup não funciona no WebView).
type WindowComCapacitor = Window & { Capacitor?: { isNativePlatform?: () => boolean } };

export const isNativeApp = (): boolean =>
  typeof window !== 'undefined' && Boolean((window as WindowComCapacitor).Capacitor?.isNativePlatform?.());
