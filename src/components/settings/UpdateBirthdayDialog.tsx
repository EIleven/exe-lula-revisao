// src/components/settings/UpdateBirthdayDialog.tsx
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
import { updateUserBirthDate } from '@/lib/services/authService';
import { useCurrentUser } from '@/contexts/CurrentUserContext';
import { Loader2 } from 'lucide-react';
import { adultBirthDateMax, isAdultBirthDate } from '@/lib/auth/birthDate';

interface UpdateBirthdayDialogProps {
  user: User;
  onOpenChange: (open: boolean) => void;
}

const updateBirthdaySchema = z.object({
  dateOfBirth: z.string().refine(isAdultBirthDate, {
    message: "Informe uma data válida e confirme ter 18 anos ou mais.",
  }),
});

type UpdateBirthdayFormValues = z.infer<typeof updateBirthdaySchema>;

export default function UpdateBirthdayDialog({ user, onOpenChange }: UpdateBirthdayDialogProps) {
  const { toast } = useToast();
  const { refreshCurrentUser } = useCurrentUser();
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const form = useForm<UpdateBirthdayFormValues>({
    resolver: zodResolver(updateBirthdaySchema),
    defaultValues: { dateOfBirth: user.dateOfBirth || '' },
  });

  const onSubmit = async (data: UpdateBirthdayFormValues) => {
    setIsSubmitting(true);
    try {
      await updateUserBirthDate(data.dateOfBirth);
      toast({
        title: 'Data de Nascimento Atualizada',
        description: 'Sua data de nascimento foi alterada com sucesso.',
      });
      await refreshCurrentUser();
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: 'Falha na Atualização',
        description: error.message || 'Ocorreu um erro ao tentar atualizar sua data de nascimento.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Alterar Data de Nascimento</DialogTitle>
        <DialogDescription>
          Esta informação ajuda a personalizar sua experiência.
        </DialogDescription>
      </DialogHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
          <FormField
            control={form.control}
            name="dateOfBirth"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Data de Nascimento</FormLabel>
                <FormControl>
                  <Input type="date" min="1900-01-01" max={adultBirthDateMax()} {...field} />
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
                    Salvar
                </Button>
            </DialogFooter>
        </form>
      </Form>
    </DialogContent>
  );
}
