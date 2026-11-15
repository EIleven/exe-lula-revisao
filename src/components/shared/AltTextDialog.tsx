// src/components/shared/AltTextDialog.tsx
'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Accessibility } from 'lucide-react';

interface AltTextDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  initialAltText?: string | null;
  onSave: (altText: string) => void;
}

export default function AltTextDialog({
  isOpen,
  onOpenChange,
  initialAltText,
  onSave,
}: AltTextDialogProps) {
  const [altText, setAltText] = useState(initialAltText || '');

  useEffect(() => {
    // Sync state if the initial prop changes while the dialog is open
    setAltText(initialAltText || '');
  }, [initialAltText, isOpen]);

  const handleSave = () => {
    onSave(altText);
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center">
             <Accessibility className="mr-2 h-5 w-5" />
            Adicionar texto alternativo
          </DialogTitle>
          <DialogDescription>
            Descreva a imagem para pessoas com deficiência visual. Um bom texto alternativo é conciso e descritivo.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Label htmlFor="alt-text-textarea" className="sr-only">
            Texto Alternativo
          </Label>
          <Textarea
            id="alt-text-textarea"
            placeholder="Ex: Um gato laranja deitado em um sofá de veludo azul..."
            value={altText}
            onChange={(e) => setAltText(e.target.value)}
            className="min-h-[100px]"
            maxLength={125}
          />
           <p className="text-xs text-right text-muted-foreground mt-2">
            {altText.length} / 125
          </p>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancelar
            </Button>
          </DialogClose>
          <Button type="button" onClick={handleSave}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
