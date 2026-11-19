// src/components/layout/HiperChatShell.tsx
'use client';

import React, { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { LogIn, LogOut, MessageSquare, Pin, Settings, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { chatBadges } from '@/lib/hiperchat/badges';
import { useHiperChatPreferences } from '@/hooks/useHiperChatPreferences';
import type { User } from '@/lib/types';

interface HiperChatShellProps {
  locale: string;
  pathname: string;
  currentUser: User | null;
  unreadMessages: number;
  isMobile: boolean;
  onLogout: () => void;
  children: React.ReactNode;
}

type NavItem = {
  id: 'conversas' | 'grupos' | 'fixadas' | 'ajustes';
  rotulo: string;
  href: string;
  Icone: typeof MessageSquare;
  ativo: boolean;
  /** Número em destaque (mensagem nova esperando). */
  alerta?: number;
  /** Número discreto (só informa quantas são). */
  contagem?: number;
};

export default function HiperChatShell({
  locale,
  pathname,
  currentUser,
  unreadMessages,
  isMobile,
  onLogout,
  children,
}: HiperChatShellProps) {
  const searchParams = useSearchParams();
  // Os números vêm da lista de conversas, que é quem ouve o Firestore (lib/hiperchat/badges.ts).
  const badges = useSyncExternalStore(chatBadges.subscribe, chatBadges.get, chatBadges.get);

  const emMensagens = pathname.startsWith(`/${locale}/messages`);
  const emAjustes = pathname.startsWith(`/${locale}/settings`);
  // Numa conversa aberta (/messages/user/x) o filtro da lista não está na barra: o item aceso é Conversas.
  const naListaRaiz = pathname === `/${locale}/messages` || pathname === `/${locale}/messages/`;
  const filtro = naListaRaiz ? searchParams?.get('filtro') ?? 'todas' : 'todas';

  // O tamanho do texto escolhido no aparelho desce por aqui: as regras em globals.css só pegam dentro de [data-hv-text].
  const { preferencias } = useHiperChatPreferences(currentUser?.id);

  // Dentro de uma conversa, no celular, a moldura sai de cena. A conversa já tem o próprio cabeçalho (Voltar + nome) e a
  // barra de abas, fixa no rodapé, disputava o mesmo lugar do compositor quando o teclado abria: o botão de enviar ficava
  // atrás de "Configurações". Com a moldura fora, a conversa ocupa a tela inteira, como manda um app de mensagens.
  const emConversa =
    pathname.startsWith(`/${locale}/messages/user/`) || pathname.startsWith(`/${locale}/messages/group/`);

  if (isMobile && emConversa) {
    return (
      <div
        data-hv-chat="conversa"
        data-hv-text={preferencias.tamanhoDoTexto}
        data-hv-recibos={preferencias.confirmacaoDeLeitura ? 'on' : 'off'}
        className="flex h-[100dvh] flex-col overflow-hidden bg-background"
      >
        <main className="mx-auto w-full min-w-0 max-w-5xl flex-1 overflow-hidden">{children}</main>
      </div>
    );
  }

  const itens: NavItem[] = [
    {
      id: 'conversas',
      rotulo: 'Conversas',
      href: `/${locale}/messages`,
      Icone: MessageSquare,
      ativo: emMensagens && filtro === 'todas',
      alerta: unreadMessages,
    },
    {
      id: 'grupos',
      rotulo: 'Grupos',
      href: `/${locale}/messages?filtro=grupos`,
      Icone: Users,
      ativo: emMensagens && filtro === 'grupos',
      alerta: badges.grupos,
    },
    {
      id: 'fixadas',
      rotulo: 'Fixadas',
      href: `/${locale}/messages?filtro=fixadas`,
      Icone: Pin,
      ativo: emMensagens && filtro === 'fixadas',
      contagem: badges.fixadas,
    },
    {
      id: 'ajustes',
      rotulo: 'Configurações',
      href: `/${locale}/settings`,
      Icone: Settings,
      ativo: emAjustes,
    },
  ];

  return (
    <div
      data-hv-chat="moldura"
      data-hv-text={preferencias.tamanhoDoTexto}
      data-hv-recibos={preferencias.confirmacaoDeLeitura ? 'on' : 'off'}
      className="min-h-screen bg-background flex flex-col"
    >
      <header className="sticky top-0 z-30 border-b border-border/80 bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 px-3 sm:px-5">
          <Link href={`/${locale}/messages`} className="flex shrink-0 items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-primary/15 border border-primary/30 text-xs font-black tracking-tight text-primary">
              HV
            </span>
            <div className="leading-tight">
              <span className="text-sm font-bold tracking-tight text-foreground">HiperChat</span>
              <span className="block text-[10px] text-muted-foreground">Mensagens · HiperVerso</span>
            </div>
          </Link>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {!isMobile && (
              <nav aria-label="Navegação HiperChat" className="flex items-center gap-1.5">
                {itens.map(({ id, rotulo, href, Icone, ativo, alerta, contagem }) => (
                  <Button
                    key={id}
                    asChild
                    variant={ativo ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-8 rounded-full px-3 text-xs"
                  >
                    <Link href={href} aria-current={ativo ? 'page' : undefined}>
                      <Icone className="mr-1.5 h-3.5 w-3.5" />
                      {rotulo}
                      {alerta !== undefined && alerta > 0 && (
                        <span className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                          {alerta > 99 ? '99+' : alerta}
                        </span>
                      )}
                      {contagem !== undefined && contagem > 0 && (
                        <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                          {contagem}
                        </span>
                      )}
                    </Link>
                  </Button>
                ))}
              </nav>
            )}

            {currentUser ? (
              <div className="flex items-center gap-2">
                <Link
                  href={`/${locale}/settings`}
                  className="flex items-center gap-2 rounded-full border border-border/70 bg-muted/30 px-2 py-1 hover:bg-muted/60 transition-colors"
                >
                  <Avatar className="h-6 w-6">
                    <AvatarImage src={currentUser.avatarUrl || undefined} alt={currentUser.name} />
                    <AvatarFallback className="text-[10px]">
                      {(currentUser.name || currentUser.username || '?')[0]?.toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden sm:inline max-w-[110px] truncate text-xs font-medium">
                    @{currentUser.username}
                  </span>
                </Link>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onLogout}
                  title="Sair"
                  className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button asChild size="sm" className="h-8 rounded-full px-3 text-xs">
                <Link href={`/${locale}/login`}>
                  <LogIn className="mr-1.5 h-3.5 w-3.5" />
                  Entrar
                </Link>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className={cn('flex-1 w-full max-w-5xl mx-auto min-w-0', isMobile && 'pb-[4.25rem]')}>
        {children}
      </main>

      {isMobile && (
        <nav
          aria-label="Navegação HiperChat"
          className="fixed bottom-0 inset-x-0 z-30 border-t border-border/80 bg-background/95 backdrop-blur"
        >
          <div className="mx-auto grid h-[4.25rem] max-w-md grid-cols-4 gap-1 px-1.5">
            {itens.map(({ id, rotulo, href, Icone, ativo, alerta, contagem }) => (
              <Link
                key={id}
                href={href}
                aria-current={ativo ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center justify-center gap-1 rounded-2xl text-[11px] font-medium transition-colors',
                  ativo ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span className="relative">
                  <Icone className={cn('h-5 w-5', ativo && 'scale-110 transition-transform')} />
                  {alerta !== undefined && alerta > 0 && (
                    <span className="absolute -right-2.5 -top-1.5 min-w-[1rem] rounded-full bg-primary px-1 text-[9px] font-bold leading-4 text-primary-foreground">
                      {alerta > 99 ? '99+' : alerta}
                    </span>
                  )}
                  {contagem !== undefined && contagem > 0 && (
                    <span className="absolute -right-2.5 -top-1.5 min-w-[1rem] rounded-full bg-muted px-1 text-[9px] font-semibold leading-4 text-muted-foreground ring-1 ring-border">
                      {contagem}
                    </span>
                  )}
                </span>
                <span className="max-w-full truncate">{rotulo}</span>
              </Link>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}
