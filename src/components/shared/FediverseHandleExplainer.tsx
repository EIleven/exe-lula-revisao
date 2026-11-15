// src/components/shared/FediverseHandleExplainer.tsx
'use client';

import React, { useRef, useState } from 'react';
import { AtSign, Check, Copy, Globe, HelpCircle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

interface FediverseHandleExplainerProps {
  username: string;
  userId?: string;
  isRemoteFediverse?: boolean;
}

export default function FediverseHandleExplainer({
  username,
  userId,
  isRemoteFediverse,
}: FediverseHandleExplainerProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanUsername = username.replace(/^@/, '');
  const isRemote = Boolean(isRemoteFediverse || userId?.startsWith('ap_') || cleanUsername.includes('@'));
  const [localPart, rawDomain] = cleanUsername.split('@');
  const domainPart = rawDomain || 'exercitodolula.app';
  const fullFediverseHandle = `@${localPart}@${domainPart}`;

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

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(fullFediverseHandle);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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
          aria-label={`Explicação sobre o endereço @${cleanUsername}`}
        >
          <span className="truncate">@{cleanUsername}</span>
          <HelpCircle className="h-3.5 w-3.5 shrink-0 opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        className="w-80 sm:w-96 p-4 space-y-3 rounded-xl shadow-xl"
        onMouseEnter={clearTimers}
        onMouseLeave={handleMouseLeave}
      >
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground leading-snug">
            Um nome de usuário funciona como um endereço de e-mail
          </p>
        </div>

        <div className="space-y-2.5 text-xs text-muted-foreground leading-relaxed">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 rounded-full bg-muted p-1.5 text-foreground shrink-0">
              <AtSign className="h-3.5 w-3.5" />
            </div>
            <p>
              {isRemote ? (
                <>
                  <span className="font-semibold text-foreground">@{localPart}</span> é o nome de
                  usuário desta conta no servidor de origem dela. Outra pessoa em outro servidor pode
                  ter o mesmo nome.
                </>
              ) : (
                <>
                  <span className="font-semibold text-foreground">@{localPart}</span> funciona aqui
                  dentro do <span className="font-medium text-foreground">Exe. Lula</span> porque
                  esta pessoa tem conta criada diretamente na rede.
                </>
              )}
            </p>
          </div>

          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 rounded-full bg-muted p-1.5 text-foreground shrink-0">
              <Globe className="h-3.5 w-3.5" />
            </div>
            <p>
              {isRemote ? (
                <>
                  <span className="font-semibold text-foreground">{domainPart}</span> é o servidor do
                  Fediverso que hospeda este perfil e suas publicações.
                </>
              ) : (
                <>
                  <span className="font-semibold text-foreground">{fullFediverseHandle}</span> é o
                  endereço completo dela no <span className="font-medium text-foreground">Fediverso</span> — uma
                  conta só! Ao entrar no Exe. Lula, cada usuário já ganha automaticamente uma conta
                  federada.
                </>
              )}
            </p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed border-t pt-2.5">
          {isRemote
            ? `Assim como você envia e-mail entre provedores diferentes, no Exe. Lula você pode seguir, mencionar e interagir com ${fullFediverseHandle} sem precisar criar conta lá.`
            : `Assim como um e-mail, quem usa Mastodon, Misskey e outros apps do Fediverso pode buscar, seguir e interagir com ${fullFediverseHandle} diretamente de lá.`}
        </p>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="w-full justify-center gap-2 text-xs"
          onClick={handleCopy}
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-green-500" />
              Endereço copiado!
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copiar {fullFediverseHandle}
            </>
          )}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

