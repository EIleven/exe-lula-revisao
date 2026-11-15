// src/components/settings/UpdateEmailDialog.tsx
'use client';

import React, { useState } from 'react';
import type { User } from '@/lib/types';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { updateUserEmail as serverUpdateUserEmail } from '@/lib/services/authService';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { Loader2 } from 'lucide-react';
import { useLocale } from 'next-intl';

interface UpdateEmailDialogProps {
  user: User;
  onOpenChange: (open: boolean) => void;
}

const getSchema = (isGoogleUser: boolean) => z.object({
  newEmail: z.string().email({ message: "Por favor, insira um e-mail válido." }),
  password: isGoogleUser
    ? z.string().optional()
    : z.string().min(1, { message: "A senha é obrigatória para confirmar a alteração." }),
});

export default function UpdateEmailDialog({ user, onOpenChange }: UpdateEmailDialogProps) {
  const { toast } = useToast();
  const { firebaseUser } = useCurrentUser();
  const locale = useLocale();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const providerId = firebaseUser?.providerData[0]?.providerId;
  const isGoogleUser = providerId === 'google.com';

  type UpdateEmailFormValues = z.infer<ReturnType<typeof getSchema>>;

  const form = useForm<UpdateEmailFormValues>({
    resolver: zodResolver(getSchema(isGoogleUser)),
    defaultValues: { newEmail: '', password: '' },
  });

  const onSubmit = async (data: UpdateEmailFormValues) => {
    setIsSubmitting(true);
    try {
      // serverUpdateUserEmail will handle re-authentication internally based on password presence
      await serverUpdateUserEmail(data.newEmail, data.password, locale);
      toast({
        title: 'Confirme o novo e-mail',
        description: 'Enviamos um link ao novo endereço. O e-mail atual permanece até você confirmar.',
      });
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: 'Falha na Atualização',
        description: error.message || 'Ocorreu um erro ao tentar atualizar seu e-mail.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Atualizar E-mail</DialogTitle>
        <DialogDescription>
          {isGoogleUser
            ? "Para alterar seu e-mail, primeiro reautentique com sua conta do Google."
            : "Insira seu novo e-mail e sua senha atual para confirmar a alteração."
          }
        </DialogDescription>
      </DialogHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
          <FormField
            control={form.control}
            name="newEmail"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Novo E-mail</FormLabel>
                <FormControl>
                  <Input type="email" placeholder="novo@email.com" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {!isGoogleUser && (
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Senha Atual</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="••••••••" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
           <DialogFooter>
                <DialogClose asChild>
                    <Button type="button" variant="outline" disabled={isSubmitting}>Cancelar</Button>
                </DialogClose>
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {isGoogleUser ? 'Reautenticar e Salvar' : 'Salvar Alterações'}
                </Button>
            </DialogFooter>
        </form>
      </Form>
    </DialogContent>
  );
}
