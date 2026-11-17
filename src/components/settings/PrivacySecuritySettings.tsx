// src/components/settings/PrivacySecuritySettings.tsx
'use client';

import React, { useState } from 'react';
import type { User } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import {
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { updateUserSettings } from '@/lib/services/userService';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import AccountSecuritySection from './AccountSecuritySection';
import RecommendationSettingsDialog from '@/components/recommendations/RecommendationSettingsDialog';
import { Button } from '@/components/ui/button';
import { SlidersHorizontal } from 'lucide-react';

interface SettingsProps {
  user: User;
}

export default function PrivacySecuritySettings({ user }: SettingsProps) {
  const { toast } = useToast();
  const { refreshCurrentUser } = useCurrentUser();
  const [isUpdating, setIsUpdating] = useState<string | null>(null);
  const [recDialogOpen, setRecDialogOpen] = useState(false);

  const handleSettingChange = async (key: keyof User, value: any) => {
    setIsUpdating(key);
    try {
      await updateUserSettings(user.id, { [key]: value });
      toast({ title: 'Sucesso', description: 'Suas configurações de privacidade foram atualizadas.' });
      await refreshCurrentUser();
    } catch (error: any) {
      toast({ title: "Erro", description: error.message || 'Falha ao atualizar a configuração.', variant: 'destructive' });
    } finally {
      setIsUpdating(null);
    }
  };

  return (
    <>
      <CardHeader>
        <CardTitle>Privacidade e Segurança</CardTitle>
        <CardDescription>
          Gerencie quem pode ver seu perfil e interagir com você.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        
        <div className="space-y-4">
            <h3 className="text-lg font-semibold text-foreground">Público e Marcação</h3>
            <p className="text-sm text-muted-foreground">
                Controle quem pode ver e mencionar sua conta.
            </p>
            <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                    <Label htmlFor="private-profile-switch" className="text-base">Perfil Privado</Label>
                    <p className="text-sm text-muted-foreground">Quando seu perfil é privado, só quem segue você vê seus posts, comentários e curtidas. Seus posts não podem ser citados.</p>
                </div>
                <Switch
                    id="private-profile-switch"
                    checked={user.profileVisibility === 'private'}
                    onCheckedChange={(checked) => handleSettingChange('profileVisibility', checked ? 'private' : 'public')}
                    disabled={!!isUpdating}
                />
            </div>
        </div>

        <Separator />

        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-foreground">Mensagens Diretas</h3>
          <p className="text-sm text-muted-foreground">
            Escolha quem pode lhe enviar solicitações de mensagens diretas.
          </p>
          <RadioGroup
            defaultValue={user.dmPreference || 'everyone'}
            onValueChange={(value) => handleSettingChange('dmPreference', value)}
            disabled={!!isUpdating}
            className="space-y-2"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="everyone" id="dm-everyone" />
              <Label htmlFor="dm-everyone" className="cursor-pointer">Todos</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="followed" id="dm-followed" />
              <Label htmlFor="dm-followed" className="cursor-pointer">Pessoas que você segue</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="none" id="dm-none" />
              <Label htmlFor="dm-none" className="cursor-pointer">Ninguém</Label>
            </div>
          </RadioGroup>
        </div>

        <Separator />

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <Label className="text-base font-medium">Algoritmo e Sugestões de Perfis</Label>
            <p className="text-sm text-muted-foreground">
              Escolha se quer ver sugestões/relacionados, quais dados podem ser usados ou oculte seu perfil das listas.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setRecDialogOpen(true)}>
            <SlidersHorizontal className="h-4 w-4 mr-1.5" />
            Configurar
          </Button>
        </div>

        <Separator />

        <AccountSecuritySection />
        <RecommendationSettingsDialog open={recDialogOpen} onOpenChange={setRecDialogOpen} />
      </CardContent>
    </>
  );
}
