// src/components/settings/UpdatePasswordDialog.tsx
'use client';

import React, { useState } from 'react';
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
import { updateUserPassword as serverUpdateUserPassword } from '@/lib/services/authService';
import { Loader2 } from 'lucide-react';
import { checkPassword } from '@/lib/auth/password';

interface UpdatePasswordDialogProps {
  onOpenChange: (open: boolean) => void;
}

const updatePasswordSchema = z.object({
  currentPassword: z.string().min(1, { message: "A senha atual é obrigatória." }),
  newPassword: z.string().refine((value) => checkPassword(value).ok, {
    message: "Use uma senha mais forte, com pelo menos 8 caracteres.",
  }),
  confirmPassword: z.string(),
}).refine(data => data.newPassword === data.confirmPassword, {
  message: "As novas senhas não coincidem.",
  path: ["confirmPassword"],
});

type UpdatePasswordFormValues = z.infer<typeof updatePasswordSchema>;

export default function UpdatePasswordDialog({ onOpenChange }: UpdatePasswordDialogProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const form = useForm<UpdatePasswordFormValues>({
    resolver: zodResolver(updatePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const onSubmit = async (data: UpdatePasswordFormValues) => {
    setIsSubmitting(true);
    try {
      await serverUpdateUserPassword(data.currentPassword, data.newPassword);
      toast({
        title: 'Senha Atualizada',
        description: 'Sua senha foi alterada com sucesso.',
      });
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: 'Falha na Atualização',
        description: error.message || 'Ocorreu um erro ao tentar atualizar sua senha.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Alterar Senha</DialogTitle>
        <DialogDescription>
          Para sua segurança, insira sua senha atual antes de definir uma nova.
        </DialogDescription>
      </DialogHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
          <FormField
            control={form.control}
            name="currentPassword"
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
          <FormField
            control={form.control}
            name="newPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nova Senha</FormLabel>
                <FormControl>
                  <Input type="password" placeholder="••••••••" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Confirmar Nova Senha</FormLabel>
                <FormControl>
                  <Input type="password" placeholder="••••••••" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
           <DialogFooter>
                <DialogClose asChild>
                    <Button type="button" variant="outline" disabled={isSubmitting}>Cancelar</Button>
                </DialogClose>
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Salvar Nova Senha
                </Button>
            </DialogFooter>
        </form>
      </Form>
    </DialogContent>
  );
}
