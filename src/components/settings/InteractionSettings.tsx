// src/components/settings/InteractionSettings.tsx
'use client';

import React, { useState } from 'react';
import type { User, ReplyPermission } from '@/lib/types';
import { useForm, FormProvider } from 'react-hook-form';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

interface SettingsProps {
  user: User;
}

const interactionSettingsSchema = z.object({
  allowReposts: z.boolean().default(true),
  replyPermission: z.enum(['everyone', 'followed', 'mentioned', 'none']).default('everyone'),
});

type InteractionSettingsFormValues = z.infer<typeof interactionSettingsSchema>;

export default function InteractionSettings({ user }: SettingsProps) {
  const { toast } = useToast();
  const { refreshCurrentUser } = useCurrentUser();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<InteractionSettingsFormValues>({
    resolver: zodResolver(interactionSettingsSchema),
    defaultValues: {
      allowReposts: user.allowReposts ?? true,
      replyPermission: user.replyPermission ?? 'everyone',
    },
  });

  const onSubmit = async (data: InteractionSettingsFormValues) => {
    setIsSubmitting(true);
    try {
      await updateUserSettings(user.id, { 
        allowReposts: data.allowReposts,
        replyPermission: data.replyPermission,
      });
      toast({
        title: 'Sucesso',
        description: 'Suas configurações de interação foram salvas.',
      });
      await refreshCurrentUser();
    } catch (error: any) {
      toast({
        title: 'Erro',
        description: error.message || 'Falha ao salvar as configurações.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <CardHeader>
        <CardTitle>Ajustes de Interação</CardTitle>
        <CardDescription>
          As opções a seguir serão utilizadas como padrão ao criar postagens novas. Você pode editar estas opções para uma postagem específica no editor.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-foreground">Configurações de Citações</h3>
              <FormField
                control={form.control}
                name="allowReposts"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Permitir citações</FormLabel>
                      <p className="text-sm text-muted-foreground">
                        Permita que outras pessoas citem suas postagens.
                      </p>
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
            </div>
            
            <Separator />

            <div className="space-y-4">
                <h3 className="text-lg font-semibold text-foreground">Configurações de Resposta</h3>
                <p className="text-sm text-muted-foreground">Permitir respostas de:</p>
                <FormField
                    control={form.control}
                    name="replyPermission"
                    render={({ field }) => (
                    <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        className="space-y-2"
                    >
                        <FormItem className="flex items-center space-x-3 space-y-0">
                            <FormControl>
                                <RadioGroupItem value="everyone" />
                            </FormControl>
                            <FormLabel className="font-normal">Todos</FormLabel>
                        </FormItem>
                         <FormItem className="flex items-center space-x-3 space-y-0">
                             <FormControl>
                                <RadioGroupItem value="followed" />
                            </FormControl>
                            <FormLabel className="font-normal">Pessoas que você segue</FormLabel>
                        </FormItem>
                         <FormItem className="flex items-center space-x-3 space-y-0">
                             <FormControl>
                                <RadioGroupItem value="mentioned" />
                            </FormControl>
                            <FormLabel className="font-normal">Apenas pessoas mencionadas</FormLabel>
                        </FormItem>
                    </RadioGroup>
                    )}
                />
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={isSubmitting || !form.formState.isDirty}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </>
  );
}
