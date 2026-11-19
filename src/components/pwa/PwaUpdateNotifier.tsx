'use client';

import { useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';

// Augment the window interface to include workbox
declare global {
  interface Window {
    workbox: any;
  }
}

// Componente para lidar com as notificações de atualização do PWA
const PwaUpdateNotifier = () => {
  const { toast } = useToast();

  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && window.workbox !== undefined) {
      const wb = window.workbox;

      // Adiciona um listener que é acionado quando um novo service worker está instalado e aguardando para ativar.
      wb.addEventListener('waiting', () => {
        toast({
          title: "Atualização Disponível",
          description: "Uma nova versão do HiperVerso está pronta. Recarregue para atualizar.",
          action: (
            <ToastAction altText="Recarregar" onClick={() => wb.messageSW({ type: 'SKIP_WAITING' })}>
              Recarregar
            </ToastAction>
          ),
          duration: Infinity, // Mantém o toast visível até ser dispensado ou a ação ser clicada
        });
      });

      // Adiciona um listener para quando o novo service worker assume o controle.
      let refreshing = false;
      wb.addEventListener('controlling', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });

      // Registra o service worker
      wb.register();
    } else if (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      process.env.NODE_ENV !== 'development'
    ) {
      // App Router: o next-pwa não injeta window.workbox, então o /sw.js nunca era registrado.
      // (Em desenvolvimento o next-pwa fica desligado e não há /sw.js.)
      const hadController = !!navigator.serviceWorker.controller;
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // Recarrega só quando uma versão NOVA assume o controle (não na primeira instalação).
        if (!hadController || refreshing) return;
        refreshing = true;
        window.location.reload();
      });
      navigator.serviceWorker.register('/sw.js').catch((error) => {
        console.error('Falha ao registrar o service worker:', error);
      });
    }
  }, [toast]);

  return null;
}

export default PwaUpdateNotifier;
