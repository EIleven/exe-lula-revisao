// src/components/settings/UpdateUsernameDialog.tsx
'use client';

import React, { useState, useEffect } from 'react';
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
import { updateUserUsername as serverUpdateUsername } from '@/lib/services/userService';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { useDebounce } from '@/hooks/use-debounce';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

type ValidationStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

const StatusIndicator = ({ status }: { status: ValidationStatus }) => {
  if (status === 'checking') return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  if (status === 'available') return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (status === 'taken' || status === 'invalid') return <XCircle className="h-4 w-4 text-destructive" />;
  return null;
};

const checkAvailability = httpsCallable(functions, 'checkAvailability');

const updateUsernameSchema = z.object({
  username: z.string()
    .min(3, { message: "O nome de usuário deve ter pelo menos 3 caracteres." })
    .max(15, { message: "O nome de usuário não pode exceder 15 caracteres." })
    .regex(/^[a-zA-Z0-9_]+$/, { message: "O nome de usuário pode conter apenas letras, números e sublinhados." }),
});

type UpdateUsernameFormValues = z.infer<typeof updateUsernameSchema>;

interface UpdateUsernameDialogProps {
  user: User;
  onOpenChange: (open: boolean) => void;
}

export default function UpdateUsernameDialog({ user, onOpenChange }: UpdateUsernameDialogProps) {
  const { toast } = useToast();
  const { refreshCurrentUser } = useCurrentUser();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<ValidationStatus>('idle');

  const form = useForm<UpdateUsernameFormValues>({
    resolver: zodResolver(updateUsernameSchema),
    defaultValues: { username: user.username || '' },
    mode: 'onChange',
  });

  const currentUsername = form.watch('username');
  const debouncedUsername = useDebounce(currentUsername, 500);

  useEffect(() => {
    if (!debouncedUsername || debouncedUsername.toLowerCase() === user.username.toLowerCase()) {
      setUsernameStatus('idle');
      return;
    }
    const validation = updateUsernameSchema.safeParse({ username: debouncedUsername });
    if (!validation.success) {
      setUsernameStatus('invalid');
      return;
    }

    setUsernameStatus('checking');
    checkAvailability({ type: 'username', value: debouncedUsername })
      .then(result => {
        const isAvailable = (result.data as { available: boolean }).available;
        setUsernameStatus(isAvailable ? 'available' : 'taken');
      })
      .catch(error => {
        console.error("Error checking username:", error);
        setUsernameStatus('idle');
      });
  }, [debouncedUsername, user.username]);

  const onSubmit = async (data: UpdateUsernameFormValues) => {
    if (usernameStatus !== 'available') {
        toast({ title: "Nome de usuário indisponível", description: "Por favor, escolha um nome de usuário diferente.", variant: "destructive"});
        return;
    }

    setIsSubmitting(true);
    try {
      await serverUpdateUsername(user.id, data.username);
      toast({
        title: 'Nome de Usuário Atualizado',
        description: 'Seu nome de usuário foi alterado com sucesso.',
      });
      await refreshCurrentUser();
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: 'Falha na Atualização',
        description: error.message || 'Ocorreu um erro ao atualizar seu nome de usuário.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusMessage = () => {
    switch (usernameStatus) {
        case 'invalid': return "Formato, comprimento ou caracteres inválidos.";
        case 'taken': return "Este nome de usuário já está em uso.";
        case 'available': return "Este nome de usuário está disponível!";
        default: return null;
    }
  };
  
  const statusMessage = getStatusMessage();
  
  return (
    <DialogContent className="sm:max-w-md p-0">
      <DialogHeader className="p-6 pb-4">
        <DialogTitle>Atualizar Nome de Usuário</DialogTitle>
        <DialogDescription>
          Alterar seu nome de usuário mudará como as pessoas mencionam e encontram você.
        </DialogDescription>
      </DialogHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 px-6 pb-6">
          <FormField
            control={form.control}
            name="username"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Novo nome de usuário</FormLabel>
                <FormControl>
                    <div className="relative">
                        <Input placeholder="novo_usuario" {...field} />
                        <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                           <StatusIndicator status={usernameStatus} />
                        </div>
                    </div>
                </FormControl>
                {statusMessage && (
                  <p className={`text-sm ${usernameStatus === 'available' ? 'text-green-500' : 'text-destructive'}`}>
                    {statusMessage}
                  </p>
                )}
                <FormMessage />
              </FormItem>
            )}
          />
           <DialogFooter className="pt-2">
                <DialogClose asChild>
                    <Button type="button" variant="outline" disabled={isSubmitting}>Cancelar</Button>
                </DialogClose>
                <Button type="submit" disabled={isSubmitting || usernameStatus !== 'available'}>
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Salvar
                </Button>
            </DialogFooter>
        </form>
      </Form>
    </DialogContent>
  );
}
