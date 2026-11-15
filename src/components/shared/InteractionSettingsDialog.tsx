
'use client';

import React, { useState, useEffect } from 'react';
import type { ReplyPermission } from '@/lib/types';
import {
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useLocale } from 'next-intl';

interface InteractionSettingsDialogProps {
  currentReplyPermission: ReplyPermission;
  currentAllowReposts: boolean;
  onSave: (settings: { replyPermission: ReplyPermission; allowReposts: boolean }) => void;
}

export default function InteractionSettingsDialog({
  currentReplyPermission,
  currentAllowReposts,
  onSave,
}: InteractionSettingsDialogProps) {
  const [replyPermission, setReplyPermission] = useState(currentReplyPermission);
  const [allowReposts, setAllowReposts] = useState(currentAllowReposts);
  const locale = useLocale();

  const hasChanges =
    replyPermission !== currentReplyPermission ||
    allowReposts !== currentAllowReposts;

  const handleSave = () => {
    onSave({ replyPermission, allowReposts });
  };

  return (
    <DialogContent className="sm:max-w-md p-0 gap-0" onOpenAutoFocus={(e) => e.preventDefault()}>
      <DialogHeader className="p-4 border-b">
        <DialogTitle className="text-lg font-semibold">
          Configurações de interação
        </DialogTitle>
        <DialogDescription className="sr-only">
          Personalize quem pode interagir com esta postagem.
        </DialogDescription>
      </DialogHeader>

      <div className="p-4 space-y-6">
        <div className="space-y-4">
          <Label className="font-bold text-base">Configurações de citações</Label>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Permitir citações</p>
            <Switch
              checked={allowReposts}
              onCheckedChange={setAllowReposts}
              aria-label="Permitir citações"
            />
          </div>
        </div>

        <Separator />

        <div className="space-y-4">
          <Label className="font-bold text-base">Permitir respostas de:</Label>
          <RadioGroup
            value={replyPermission}
            onValueChange={(value: ReplyPermission) => setReplyPermission(value)}
            className="space-y-2"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="everyone" id="everyone" />
              <Label htmlFor="everyone" className="font-normal cursor-pointer">Todos</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="followed" id="followed" />
              <Label htmlFor="followed" className="font-normal cursor-pointer">Pessoas que você segue</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="mentioned" id="mentioned" />
              <Label htmlFor="mentioned" className="font-normal cursor-pointer">Apenas pessoas mencionadas</Label>
            </div>
          </RadioGroup>
        </div>
      </div>

      <DialogFooter className="p-4 border-t">
        <DialogClose asChild>
          <Button onClick={handleSave} className="w-full">
            Salvar
          </Button>
        </DialogClose>
        <p className="text-xs text-center text-muted-foreground pt-2">
          Você pode definir os Ajustes de interação padrão em{" "}
          <Link href={`/${locale}/settings`} className="underline hover:text-primary">
            Configurações
          </Link>.
        </p>
      </DialogFooter>
    </DialogContent>
  );
}
