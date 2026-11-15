// src/components/messages/MessageInputArea.tsx
'use client';

import { useMemo, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverAnchor } from '@/components/ui/popover';
import MentionSuggestions from '@/components/mentions/MentionSuggestions';
import { useMentions } from '@/hooks/features/mentions/useMentions';
import { Send, Loader2, Paperclip, X, Mic, Square, Camera, UploadCloud } from 'lucide-react';
import type { DirectMessage } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { extractYoutubeVideoInfo } from '@/lib/utils/youtubeLinks';
import YoutubeEmbed from '@/components/shared/YoutubeEmbed';
import { isUserFacingError } from '@/lib/services/userFacingError';

interface MessageInputAreaProps {
  onSendMessage: (data: { text?: string; fileUrl?: string; fileType?: DirectMessage['fileType'] }) => Promise<void>;
  onFileUpload: (file: File) => Promise<{ url: string, type: DirectMessage['fileType'] }>;
  disabled?: boolean;
  replyingTo?: DirectMessage | null;
  onCancelReply?: () => void;
}

export default function MessageInputArea({ 
    onSendMessage, 
    onFileUpload, 
    disabled = false, 
    replyingTo, 
    onCancelReply 
}: MessageInputAreaProps) {
  const [messageText, setMessageText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();
  const youtubePreview = useMemo(() => extractYoutubeVideoInfo(messageText).videoId, [messageText]);
  const {
    suggestionType,
    suggestionQuery,
    suggestionsOpen,
    setSuggestionsOpen,
    handleSelect: handleSelectMentionFromHook,
  } = useMentions(messageText, textareaRef);

  const handleSelectMention = (value: string) => {
    const result = handleSelectMentionFromHook(value);
    if (!result) return;
    setMessageText(result.newText);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(result.newCursorPosition, result.newCursorPosition);
      }
    }, 0);
  };

  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  
  const selectFile = (selectedFile: File | null | undefined) => {
    if (!selectedFile) return;
    if (!selectedFile.type.startsWith('video/') && selectedFile.size >= 5 * 1024 * 1024) {
      toast({
        title: 'Arquivo muito grande',
        description: 'Escolha um arquivo menor que 5 MB.',
        variant: 'destructive',
      });
      return;
    }
    setFile(selectedFile);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    selectFile(event.target.files?.[0]);
    // Reset file input to allow selecting the same file again
    if (event.target) {
        event.target.value = '';
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedFile = Array.from(event.clipboardData.items)
      .find((item) => item.kind === 'file' && /^(image|video|audio)\//.test(item.type))
      ?.getAsFile();
    if (!pastedFile) return;
    event.preventDefault();
    selectFile(pastedFile);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingOver(false);
    selectFile(Array.from(event.dataTransfer.files).find((entry) => /^(image|video|audio)\//.test(entry.type)) ?? event.dataTransfer.files[0]);
  };
  
  const handleCameraClick = () => {
    cameraInputRef.current?.click();
  };

  const handleStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const audioFile = new File([audioBlob], `recording-${Date.now()}.webm`, { type: 'audio/webm' });
        setFile(audioFile);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
      toast({ title: "Recording started..." });
    } catch (err) {
      console.error("Error accessing microphone:", err);
      toast({ title: "Microphone access denied", description: "Please enable microphone permissions in your browser.", variant: "destructive" });
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      toast({ title: "Recording stopped." });
    }
  };

  const handleSubmit = async (e?: React.FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    if (isSending || disabled) return;
    if (!messageText.trim() && !file) return;

    const textToSend = messageText.trim();
    const fileToSend = file;
    setIsSending(true);
    // Retira a previa assim que o envio comeca. O snapshot do Firestore pode trazer a
    // mensagem antes de a Promise de envio terminar; manter o texto aqui nesse intervalo
    // mostrava dois players do mesmo YouTube (compositor + balao) por alguns instantes.
    setMessageText('');
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    let filePayload: { url: string, type: DirectMessage['fileType'] } | undefined;

    try {
      if (fileToSend) {
        setIsUploading(true);
        try {
          filePayload = await onFileUpload(fileToSend);
        } catch (uploadError) {
          console.error("Failed to upload file:", uploadError);
          toast({ title: 'Upload Failed', description: 'Could not upload the selected file.', variant: 'destructive' });
          setMessageText(textToSend);
          setFile(fileToSend);
          setIsSending(false);
          setIsUploading(false);
          return;
        } finally {
          setIsUploading(false);
        }
      }
      
      await onSendMessage({
        text: textToSend,
        ...(filePayload && { fileUrl: filePayload.url, fileType: filePayload.type }),
      });
    } catch (error) {
      console.error("Failed to send message:", error);
      setMessageText(textToSend);
      setFile(fileToSend);
      // Recusa com motivo que a pessoa precisa saber (E2EE indisponível, Zero DB sem o contato conectado): o texto volta ao
      // campo e o motivo aparece; qualquer outro erro continua sendo o aviso genérico.
      toast(isUserFacingError(error)
        ? { title: 'Mensagem não enviada', description: error.message, variant: 'destructive' }
        : { title: "Message Not Sent", description: "An error occurred while sending your message.", variant: "destructive" });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div
      className="relative min-w-0 p-2 border-t border-border bg-background sticky bottom-0"
      onDragEnter={(event) => { event.preventDefault(); setIsDraggingOver(true); }}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setIsDraggingOver(true); }}
      onDragLeave={(event) => {
        event.preventDefault();
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        setIsDraggingOver(false);
      }}
      onDrop={handleDrop}
      data-testid="message-composer"
    >
      {replyingTo && (
        <div className="bg-muted px-3 py-2 rounded-t-md mb-2 relative border-l-2 border-primary">
            <Button variant="ghost" size="icon" className="absolute top-1 right-1 h-6 w-6" onClick={onCancelReply}>
              <X className="h-4 w-4" />
              <span className="sr-only">Cancel reply</span>
            </Button>
            <p className="text-sm font-semibold text-primary">{replyingTo.sender?.name}</p>
            <p className="text-sm text-muted-foreground truncate">{replyingTo.text || (replyingTo.fileUrl ? 'Media attachment' : 'Shared post')}</p>
        </div>
      )}
      {file && (
        <div className="flex items-center justify-between bg-muted p-2 rounded-md mb-2">
          <div className="flex items-center space-x-2 overflow-hidden">
            <Paperclip className="h-4 w-4 flex-shrink-0" />
            <span className="text-sm truncate">{file.name}</span>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setFile(null)} disabled={isSending}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
      {youtubePreview && !file && (
        <YoutubeEmbed videoId={youtubePreview} className="mb-2 max-w-xl" title="Prévia do vídeo do YouTube" />
      )}
      <form onSubmit={handleSubmit} className="relative flex min-w-0 w-full items-end rounded-lg border bg-muted focus-within:ring-2 focus-within:ring-ring">
        <Popover open={suggestionsOpen} onOpenChange={setSuggestionsOpen}>
          <PopoverAnchor asChild>
            <Textarea
              id="message-input-area"
              ref={textareaRef}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              onPaste={handlePaste}
              placeholder="Digite sua mensagem..."
              rows={1}
              className="min-w-0 flex-1 resize-none border-none bg-transparent p-3 pr-40 shadow-none focus-visible:ring-0 min-h-[40px] max-h-[120px]"
              disabled={isSending || isUploading || disabled || isRecording}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && suggestionsOpen) {
                  e.preventDefault();
                  setSuggestionsOpen(false);
                  return;
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
          </PopoverAnchor>
          {suggestionsOpen && (
            <MentionSuggestions
              type={suggestionType}
              query={suggestionQuery}
              onSelect={handleSelectMention}
              side="top"
            />
          )}
        </Popover>
        <div className="absolute right-1 bottom-1 flex items-center">
            <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/*,video/*,audio/*" />
            <input type="file" capture accept="image/*,video/*" ref={cameraInputRef} onChange={handleFileChange} className="hidden" />
            <Button type="button" variant="ghost" size="icon" onClick={handleCameraClick} disabled={isSending || isUploading || disabled || isRecording}>
                <Camera className="h-5 w-5" />
                <span className="sr-only">Usar câmera</span>
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()} disabled={isSending || isUploading || disabled || isRecording}>
                <Paperclip className="h-5 w-5" />
                <span className="sr-only">Anexar arquivo</span>
            </Button>
            <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={isRecording ? handleStopRecording : handleStartRecording}
                disabled={isSending || isUploading || disabled}
                className="text-primary"
            >
                {isRecording ? <Square className="h-5 w-5 text-destructive fill-current" /> : <Mic className="h-5 w-5" />}
                <span className="sr-only">{isRecording ? 'Parar gravação' : 'Iniciar gravação'}</span>
            </Button>
            <Button 
                type="submit" 
                size="icon" 
                disabled={isSending || isUploading || disabled || isRecording || (!messageText.trim() && !file)}
            >
              {isSending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
              <span className="sr-only">Enviar Mensagem</span>
            </Button>
        </div>
      </form>
      {isDraggingOver && (
        <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/95 text-primary">
          <UploadCloud className="h-8 w-8" aria-hidden="true" />
          <p className="mt-1 text-sm font-semibold">Solte a imagem, o vídeo ou o áudio para anexar</p>
        </div>
      )}
    </div>
  );
}
