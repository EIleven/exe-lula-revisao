// src/components/shared/FediverseHandleExplainer.tsx
'use client';

import React, { useRef, useState } from 'react';
import { AtSign, Check, Copy, Globe, HelpCircle, MessageCircle, Share2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { siteConfig } from '@/config/site';

interface FediverseHandleExplainerProps {
  username: string;
  userId?: string;
  isRemoteFediverse?: boolean;
  federatedLoginProvider?: 'fediverse' | 'bluesky';
  federatedLoginHandle?: string;
  matrixHandle?: string | null;
}

interface NetworkAddressItem {
  id: string;
  network: string;
  handle: string;
  description: string;
  icon: React.ElementType;
}

export default function FediverseHandleExplainer({
  username,
  userId,
  isRemoteFediverse,
  federatedLoginProvider,
  federatedLoginHandle,
  matrixHandle,
}: FediverseHandleExplainerProps) {
  const [open, setOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanUsername = username.replace(/^@/, '');
  const isRemote = Boolean(isRemoteFediverse || userId?.startsWith('ap_') || cleanUsername.includes('@'));
  const [localPart, rawDomain] = cleanUsername.split('@');
  const domainPart = rawDomain || siteConfig.federationHost;
  const fullFediverseHandle = `@${localPart}@${domainPart}`;

  const addresses: NetworkAddressItem[] = [];

  if (!isRemote) {
    addresses.push({
      id: 'local',
      network: 'HiperVerso',
      handle: `@${localPart}`,
      description: 'Perfil interno na rede.',
      icon: AtSign,
    });
  }

  addresses.push({
    id: 'activitypub',
    network: isRemote ? `Fediverso (${domainPart})` : 'Fediverso (ActivityPub)',
    handle: fullFediverseHandle,
    description: isRemote
      ? 'Perfil externo acessível sem criar conta lá.'
      : 'Use em Mastodon, Misskey e outros apps federados.',
    icon: Globe,
  });

  if (federatedLoginHandle?.trim()) {
    const cleanFed = `@${federatedLoginHandle.trim().replace(/^@/, '')}`;
    const isBsky = federatedLoginProvider === 'bluesky';
    addresses.push({
      id: 'federated-login',
      network: isBsky ? 'Bluesky (ATProto)' : 'Fediverso vinculado',
      handle: cleanFed,
      description: isBsky
        ? 'Conta externa conectada via protocolo Bluesky.'
        : 'Conta externa vinculada a este perfil.',
      icon: Share2,
    });
  }

  if (matrixHandle?.trim()) {
    addresses.push({
      id: 'matrix',
      network: 'Matrix',
      handle: matrixHandle.trim(),
      description: 'Identidade aberta para salas e mensagens Matrix.',
      icon: MessageCircle,
    });
  }

  const clearTimers = () => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const handleMouseEnter = () => {
    clearTimers();
    openTimerRef.current = setTimeout(() => setOpen(true), 150);
  };

  const handleMouseLeave = () => {
    clearTimers();
    closeTimerRef.current = setTimeout(() => setOpen(false), 180);
  };

  const handleCopy = async (e: React.MouseEvent, id: string, value: string) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(id);
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1800);
    } catch {
      // ignora se clipboard não estiver disponível
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onClick={(e) => {
            e.stopPropagation();
            clearTimers();
            setOpen((prev) => !prev);
          }}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm min-w-0 max-w-full text-left"
          aria-label={`Endereços conectados de @${cleanUsername}`}
        >
          <span className="truncate">@{cleanUsername}</span>
          <HelpCircle className="h-3.5 w-3.5 shrink-0 opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        className="w-80 sm:w-96 p-3.5 space-y-2.5 rounded-xl shadow-xl"
        onMouseEnter={clearTimers}
        onMouseLeave={handleMouseLeave}
      >
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Endereços conectados
          </p>
          <span className="text-[11px] text-muted-foreground">
            {addresses.length} {addresses.length === 1 ? 'rede' : 'redes'}
          </span>
        </div>

        <div className="space-y-2">
          {addresses.map((item) => {
            const Icon = item.icon;
            const isCopied = copiedId === item.id;
            return (
              <div
                key={item.id}
                className="flex items-start justify-between gap-2 rounded-lg border border-border/70 bg-muted/30 px-2.5 py-2"
              >
                <div className="flex items-start gap-2 min-w-0">
                  <div className="mt-0.5 rounded-full bg-background p-1 text-primary shrink-0 border border-border/60">
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-muted-foreground leading-none">
                      {item.network}
                    </p>
                    <p className="text-xs font-semibold text-foreground truncate mt-1">
                      {item.handle}
                    </p>
                    <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                      {item.description}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => void handleCopy(e, item.id, item.handle)}
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-background hover:text-foreground transition-colors"
                  aria-label={`Copiar ${item.handle}`}
                  title={`Copiar ${item.handle}`}
                >
                  {isCopied ? (
                    <Check className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
