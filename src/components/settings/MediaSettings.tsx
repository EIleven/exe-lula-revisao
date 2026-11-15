// src/components/settings/MediaSettings.tsx
'use client';

import React, { useState } from 'react';
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
import { Loader2 } from 'lucide-react';
import { updateUserSettings } from '@/lib/services/userService';
import { useCurrentUser } from '@/contexts/CurrentUserContext';

interface SettingsProps {
  user: User;
}

const mediaSettingsSchema = z.object({
  displaySensitiveContent: z.boolean().default(false),
});

type MediaSettingsFormValues = z.infer<typeof mediaSettingsSchema>;

export default function MediaSettings({ user }: SettingsProps) {
  const { toast } = useToast();
  const { refreshCurrentUser } = useCurrentUser();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<MediaSettingsFormValues>({
    resolver: zodResolver(mediaSettingsSchema),
    defaultValues: {
      displaySensitiveContent: user.displaySensitiveContent ?? false,
    },
  });

  const onSubmit = async (data: MediaSettingsFormValues) => {
    setIsSubmitting(true);
    try {
      await updateUserSettings(user.id, { displaySensitiveContent: data.displaySensitiveContent });
      toast({
        title: 'Sucesso',
        description: 'Suas preferências de mídia foram salvas.',
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

  return (
    <>
      <CardHeader>
        <CardTitle>Conteúdo e Mídia</CardTitle>
        <CardDescription>Gerencie suas configurações de conteúdo e mídia.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <FormField
              control={form.control}
              name="displaySensitiveContent"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Exibir conteúdo sensível</FormLabel>
                    <p className="text-sm text-muted-foreground">
                      Ative para ver mídias que podem conter conteúdo sensível.
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
            <div className="flex justify-end">
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
