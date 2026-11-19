// src/components/settings/NotificationsSettings.tsx
'use client';

import React, { useState, useEffect } from 'react';
import type { User } from '@/lib/types';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { Loader2 } from 'lucide-react';
import { updateUserSettings } from '@/lib/services/userService';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { disablePush, enablePush, getPushPermission, isPushActive, type PushPermission } from '@/lib/services/pushNotificationService';
import { isHapticsEnabled, isHapticsSupported, setHapticsEnabled } from '@/lib/haptics';
import { friendlyErrorMessage } from '@/lib/utils/friendlyError';
import { useLocale } from 'next-intl';
import { Label } from '@/components/ui/label';

interface SettingsProps {
  user: User;
}

const notificationSettingsSchema = z.object({
  likes: z.boolean().default(true),
  comments: z.boolean().default(true),
  reposts: z.boolean().default(true),
  newFollowers: z.boolean().default(true),
  mentions: z.boolean().default(true),
  directMessages: z.boolean().default(true),
});

type NotificationSettingsFormValues = z.infer<typeof notificationSettingsSchema>;

const NOTIFICATION_TYPES = [
  { id: 'likes', label: 'Curtidas em seus posts, artigos e repostagens' },
  { id: 'comments', label: 'Comentários e respostas' },
  { id: 'reposts', label: 'Reposts, citações e repostagens de repostagens' },
  { id: 'newFollowers', label: 'Novos seguidores e seguidas de volta' },
  { id: 'mentions', label: 'Menções ao seu @username' },
  { id: 'directMessages', label: 'Mensagens diretas (aviso no aparelho)' },
] as const;

export default function NotificationsSettings({ user }: SettingsProps) {
  const { toast } = useToast();
  const { refreshCurrentUser } = useCurrentUser();
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const locale = useLocale();
  const [isPushSubscribed, setIsPushSubscribed] = useState(false);
  const [isPushSubscriptionLoading, setIsPushSubscriptionLoading] = useState(true);
  const [pushPermission, setPushPermission] = useState<PushPermission>('prompt');
  const [hapticsOn, setHapticsOn] = useState(true);
  const [hapticsAvailable, setHapticsAvailable] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([getPushPermission(), isPushActive(user.id)]).then(([permission, activeNow]) => {
      if (!active) return;
      setPushPermission(permission);
      setIsPushSubscribed(activeNow);
      setIsPushSubscriptionLoading(false);
    });
    setHapticsAvailable(isHapticsSupported());
    setHapticsOn(isHapticsEnabled());
    return () => { active = false; };
  }, [user.id]);

  const form = useForm<NotificationSettingsFormValues>({
    resolver: zodResolver(notificationSettingsSchema),
    defaultValues: {
      likes: user.notificationPreferences?.likes ?? true,
      comments: user.notificationPreferences?.comments ?? true,
      reposts: user.notificationPreferences?.reposts ?? true,
      newFollowers: user.notificationPreferences?.newFollowers ?? true,
      mentions: user.notificationPreferences?.mentions ?? true,
      directMessages: user.notificationPreferences?.directMessages ?? true,
    },
  });

  const onSubmit = async (data: NotificationSettingsFormValues) => {
    setIsSubmitting(true);
    try {
      await updateUserSettings(user.id, { notificationPreferences: data });
      toast({
        title: 'Sucesso',
        description: 'Suas preferências de notificação foram salvas.',
      });
      await refreshCurrentUser();
    } catch (error: any) {
      toast({
        title: 'Erro',
        description: error.message || 'Falha ao salvar as preferências.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubscriptionToggle = async () => {
    if (!user) return;
    setIsPushSubscriptionLoading(true);
    try {
        if (isPushSubscribed) {
            await disablePush(user.id);
            setIsPushSubscribed(false);
            toast({ title: 'Notificações push desativadas neste aparelho' });
        } else {
            await enablePush(user.id, locale);
            setIsPushSubscribed(true);
            toast({ title: 'Notificações push ativadas!', description: 'Você vai receber os avisos neste aparelho.' });
        }
    } catch (error: unknown) {
        console.error('Erro ao alterar as notificações push:', error);
        toast({ title: 'Não foi possível alterar as notificações', description: friendlyErrorMessage(error, 'Tente de novo em instantes.'), variant: 'destructive' });
    } finally {
        setIsPushSubscriptionLoading(false);
        setPushPermission(await getPushPermission());
    }
  };

  return (
    <>
      <CardHeader>
        <CardTitle>Notificações</CardTitle>
        <CardDescription>
          Escolha quais notificações você deseja receber.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <div>
              <h3 className="text-lg font-semibold text-foreground mb-4">Notificações no App</h3>
              <div className="space-y-4">
                {NOTIFICATION_TYPES.map(item => (
                  <FormField
                    key={item.id}
                    control={form.control}
                    name={item.id}
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                        <div className="space-y-0.5">
                          <FormLabel className="text-base">{item.label}</FormLabel>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                ))}
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-foreground">Notificações Push</h3>
              <div className="flex flex-row items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label className="text-base">Notificações no Dispositivo</Label>
                  <p className="text-sm text-muted-foreground">
                    Receba alertas mesmo quando não estiver com o app aberto.
                  </p>
                </div>
                {pushPermission === 'denied' ? (
                  <p className="text-sm text-destructive font-medium">Bloqueadas</p>
                ) : pushPermission === 'unsupported' ? (
                  <p className="text-sm text-muted-foreground font-medium">Indisponível</p>
                ) : (
                  // type="button": está dentro do formulário e, sem isso, "Ativar" também enviava o formulário.
                  <Button type="button" onClick={handleSubscriptionToggle} disabled={isPushSubscriptionLoading} data-testid="push-toggle">
                    {isPushSubscriptionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {isPushSubscribed ? 'Desativar' : 'Ativar'}
                  </Button>
                )}
              </div>
              {pushPermission === 'denied' && (
                <p className="text-xs text-muted-foreground px-4">
                  Você precisa permitir notificações nas configurações do seu navegador ou do aparelho para ativar esta funcionalidade.
                </p>
              )}
              {pushPermission === 'unsupported' && (
                <p className="text-xs text-muted-foreground px-4">
                  Este navegador não oferece notificações push. No celular, use o app do HiperVerso ou adicione o site à tela inicial.
                </p>
              )}
            </div>

            {hapticsAvailable && (
              <>
                <Separator />
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-foreground">Vibração</h3>
                  <div className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <Label htmlFor="haptics-switch" className="text-base">Vibrar levemente ao tocar</Label>
                      <p className="text-sm text-muted-foreground">
                        Um toque sutil no celular ao curtir, repostar, enviar e usar os botões.
                      </p>
                    </div>
                    <Switch
                      id="haptics-switch"
                      checked={hapticsOn}
                      onCheckedChange={(checked) => { setHapticsEnabled(checked); setHapticsOn(checked); }}
                    />
                  </div>
                </div>
              </>
            )}

            <div className="flex justify-end pt-4">
              <Button type="submit" disabled={isSubmitting || !form.formState.isDirty}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar Preferências
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </>
  );
}
