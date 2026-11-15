// src/components/editor/Toolbar.tsx

'use client';

import React, { useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import {
  Bold, Italic, Strikethrough, List, ListOrdered, Image as ImageIcon,
  AlignLeft, AlignCenter, AlignRight, FileVideo, Paperclip,
  Heading1, Heading2, Heading3, Quote, Code, Minus, Undo2, Redo2,
  Link2, Youtube, Type
} from 'lucide-react';
import { Toggle } from '@/components/ui/toggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { isLikelyVideoFile } from '@/lib/services/mediaUploadService';
import { extractYoutubeVideoInfo } from '@/lib/utils/textUtils';

export type ArticleFontStyle = 'sans' | 'serif';

type ToolbarProps = {
  editor: Editor;
  onImageUpload: (file: File) => Promise<string | null>;
  fontStyle?: ArticleFontStyle;
  onFontStyleChange?: (style: ArticleFontStyle) => void;
};

const MAX_MEDIA_ITEMS = 5;

export const Toolbar = ({ editor, onImageUpload, fontStyle = 'sans', onFontStyleChange }: ToolbarProps) => {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [ytOpen, setYtOpen] = useState(false);
  const [ytUrl, setYtUrl] = useState('');
  const { toast } = useToast();

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Clear the input value to allow uploading the same file again
    event.target.value = '';

    const currentMediaCount = (editor.getHTML().match(/<(img|video)/g) || []).length;
    if (currentMediaCount >= MAX_MEDIA_ITEMS) {
        toast({
            title: "Limite de Mídia Atingido",
            description: `Você pode adicionar no máximo ${MAX_MEDIA_ITEMS} mídias por artigo.`,
            variant: "destructive",
        });
        return;
    }

    const url = await onImageUpload(file);
    if (url) {
        if (file.type.startsWith('image/')) {
            editor.chain().focus().insertContent({
                type: 'resizableImage',
                attrs: { src: url },
            }).run();
        } else if (isLikelyVideoFile(file)) {
            editor.chain().focus().insertContent({
                type: 'videoNode',
                attrs: { src: url },
            }).run();
        } else {
            const linkContent = `<p><a href="${url}" target="_blank" rel="noopener noreferrer" style="display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.5rem 1rem; border: 1px solid hsl(var(--border)); border-radius: 0.5rem; text-decoration: none; margin-block: 1rem;">${file.name}</a></p>`;
            editor.chain().focus().insertContent(linkContent).run();
        }
    }
  };

  const insertLink = () => {
    const clean = linkUrl.trim();
    if (!clean) {
      setLinkOpen(false);
      return;
    }
    const href = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
    const selectedText = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '');
    const label = selectedText || clean.replace(/^https?:\/\//i, '');
    editor
      .chain()
      .focus()
      .insertContent(`<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a> `)
      .run();
    setLinkUrl('');
    setLinkOpen(false);
  };

  const insertYoutube = () => {
    const { videoId } = extractYoutubeVideoInfo(ytUrl.trim());
    if (!videoId) {
      toast({ title: 'Link do YouTube inválido', description: 'Cole uma URL válida de vídeo do YouTube.', variant: 'destructive' });
      return;
    }
    editor.chain().focus().insertContent({ type: 'youtube', attrs: { videoId } }).run();
    setYtUrl('');
    setYtOpen(false);
  };

  return (
    <div className="w-full max-w-full min-w-0 overflow-x-hidden border-b border-border bg-muted/20 px-2 py-1.5 flex items-center flex-wrap gap-0.5 sm:gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        aria-label="Desfazer"
        title="Desfazer"
      >
        <Undo2 className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        aria-label="Refazer"
        title="Refazer"
      >
        <Redo2 className="h-4 w-4" />
      </Button>

      <Separator orientation="vertical" className="h-5 mx-1" />

      <Toggle
        size="sm"
        pressed={editor.isActive('heading', { level: 1 })}
        onPressedChange={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        aria-label="Título 1"
        title="Título grande (H1)"
      >
        <Heading1 className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive('heading', { level: 2 })}
        onPressedChange={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        aria-label="Título 2"
        title="Subtítulo (H2)"
      >
        <Heading2 className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive('heading', { level: 3 })}
        onPressedChange={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        aria-label="Título 3"
        title="Seção (H3)"
      >
        <Heading3 className="h-4 w-4" />
      </Toggle>

      <Separator orientation="vertical" className="h-5 mx-1" />

      <Toggle
        size="sm"
        pressed={editor.isActive('bold')}
        onPressedChange={() => editor.chain().focus().toggleBold().run()}
        aria-label="Negrito"
        title="Negrito"
      >
        <Bold className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive('italic')}
        onPressedChange={() => editor.chain().focus().toggleItalic().run()}
        aria-label="Itálico"
        title="Itálico"
      >
        <Italic className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive('strike')}
        onPressedChange={() => editor.chain().focus().toggleStrike().run()}
        aria-label="Tachado"
        title="Tachado"
      >
        <Strikethrough className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive('codeBlock')}
        onPressedChange={() => editor.chain().focus().toggleCodeBlock().run()}
        aria-label="Bloco de código"
        title="Bloco de código"
      >
        <Code className="h-4 w-4" />
      </Toggle>

      <Separator orientation="vertical" className="h-5 mx-1" />

      <Toggle
        size="sm"
        pressed={editor.isActive('blockquote')}
        onPressedChange={() => editor.chain().focus().toggleBlockquote().run()}
        aria-label="Citação"
        title="Citação em destaque"
      >
        <Quote className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive('bulletList')}
        onPressedChange={() => editor.chain().focus().toggleBulletList().run()}
        aria-label="Lista"
        title="Lista com marcadores"
      >
        <List className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive('orderedList')}
        onPressedChange={() => editor.chain().focus().toggleOrderedList().run()}
        aria-label="Lista numerada"
        title="Lista numerada"
      >
        <ListOrdered className="h-4 w-4" />
      </Toggle>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        aria-label="Divisor"
        title="Inserir separador"
      >
        <Minus className="h-4 w-4" />
      </Button>

      <Separator orientation="vertical" className="h-5 mx-1" />

      {/* Link & YouTube */}
      <Popover open={linkOpen} onOpenChange={setLinkOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label="Inserir Link" title="Inserir Link">
            <Link2 className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2.5 space-y-2" align="start">
          <p className="text-xs font-medium">Inserir link</p>
          <div className="flex gap-1.5">
            <Input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://..."
              className="h-8 text-xs"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  insertLink();
                }
              }}
            />
            <Button type="button" size="sm" className="h-8 text-xs" onClick={insertLink}>
              OK
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <Popover open={ytOpen} onOpenChange={setYtOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label="Inserir vídeo do YouTube" title="Incorporar YouTube">
            <Youtube className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2.5 space-y-2" align="start">
          <p className="text-xs font-medium">Incorporar vídeo do YouTube</p>
          <div className="flex gap-1.5">
            <Input
              value={ytUrl}
              onChange={(e) => setYtUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              className="h-8 text-xs"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  insertYoutube();
                }
              }}
            />
            <Button type="button" size="sm" className="h-8 text-xs" onClick={insertYoutube}>
              Inserir
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Hidden file inputs */}
      <input
        type="file"
        accept="image/*"
        ref={imageInputRef}
        onChange={handleFileUpload}
        className="hidden"
      />
       <input
        type="file"
        accept="video/*"
        ref={videoInputRef}
        onChange={handleFileUpload}
        className="hidden"
      />
       <input
        type="file"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.zip,.txt"
        ref={attachmentInputRef}
        onChange={handleFileUpload}
        className="hidden"
      />

      {/* Visible media buttons */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        onClick={() => imageInputRef.current?.click()}
        aria-label="Upload Image"
        title="Inserir imagem"
      >
        <ImageIcon className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        onClick={() => videoInputRef.current?.click()}
        aria-label="Upload Video"
        title="Inserir vídeo"
      >
        <FileVideo className="h-4 w-4" />
      </Button>
       <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        onClick={() => attachmentInputRef.current?.click()}
        aria-label="Upload Attachment"
        title="Anexar arquivo"
      >
        <Paperclip className="h-4 w-4" />
      </Button>

      <Separator orientation="vertical" className="h-5 mx-1" />
      
      {/* Text Alignment Buttons */}
      <Toggle
        size="sm"
        pressed={editor.isActive({ textAlign: 'left' })}
        onPressedChange={() => editor.chain().focus().setTextAlign('left').run()}
        aria-label="Alinhar à esquerda"
        title="Alinhar à esquerda"
      >
        <AlignLeft className="h-4 w-4" />
      </Toggle>
       <Toggle
        size="sm"
        pressed={editor.isActive({ textAlign: 'center' })}
        onPressedChange={() => editor.chain().focus().setTextAlign('center').run()}
        aria-label="Centralizar"
        title="Centralizar"
      >
        <AlignCenter className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={editor.isActive({ textAlign: 'right' })}
        onPressedChange={() => editor.chain().focus().setTextAlign('right').run()}
        aria-label="Alinhar à direita"
        title="Alinhar à direita"
      >
        <AlignRight className="h-4 w-4" />
      </Toggle>

      {onFontStyleChange && (
        <>
          <Separator orientation="vertical" className="h-5 mx-1" />
          <Button
            type="button"
            variant={fontStyle === 'serif' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 px-2 gap-1 text-xs"
            onClick={() => onFontStyleChange(fontStyle === 'sans' ? 'serif' : 'sans')}
            title="Alternar fonte editorial (Sans / Serif)"
          >
            <Type className="h-3.5 w-3.5" />
            <span className={fontStyle === 'serif' ? 'font-serif' : 'font-sans'}>
              {fontStyle === 'serif' ? 'Serif' : 'Sans'}
            </span>
          </Button>
        </>
      )}
    </div>
  );
};
