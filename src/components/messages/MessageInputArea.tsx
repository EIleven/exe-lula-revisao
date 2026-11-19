// src/components/messages/MessageInputArea.tsx
'use client';

import { useMemo, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverAnchor } from '@/components/ui/popover';
import MentionSuggestions from '@/components/mentions/MentionSuggestions';
import { useMentions } from '@/hooks/features/mentions/useMentions';
import { Send, Loader2, Paperclip, X, Mic, Square, Camera, UploadCloud } from 'lucide-react';
import type { DirectMessage, E2eeMessagePayload } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { extractYoutubeVideoInfo } from '@/lib/utils/youtubeLinks';
import YoutubeEmbed from '@/components/shared/YoutubeEmbed';
import { isUserFacingError } from '@/lib/services/userFacingError';
import { avaliarAnexo, formatarTamanho } from '@/lib/messages/anexoPolitica';

interface MessageInputAreaProps {
  onSendMessage: (data: { text?: string; fileUrl?: string; fileType?: DirectMessage['fileType']; mediaE2ee?: E2eeMessagePayload | null; posterUrl?: string | null }) => Promise<void>;
  /** `aoProgredir` recebe 0..100 durante o envio; quem chama repassa para o serviço de upload. */
  onFileUpload: (
    file: File,
    aoProgredir?: (porcentagem: number) => void,
  ) => Promise<{ url: string; type: DirectMessage['fileType']; mediaE2ee?: E2eeMessagePayload | null; posterUrl?: string | null }>;
  disabled?: boolean;
  replyingTo?: DirectMessage | null;
  onCancelReply?: () => void;
  /**
   * Esta conversa manda tudo cifrado? Muda o caminho e o teto do anexo: acima de 5 MB o arquivo vai cifrado em
   * pedaços, até 200 MB. A tela avisa na hora de escolher, não depois de cifrar.
   */
  conversaCifrada?: boolean;
}

export default function MessageInputArea({ 
    onSendMessage, 
    onFileUpload, 
    disabled = false, 
    replyingTo, 
    onCancelReply,
    conversaCifrada = false,
}: MessageInputAreaProps) {
  const [messageText, setMessageText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progresso, setProgresso] = useState(0);
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
    const veredito = avaliarAnexo(selectedFile, { cifrada: conversaCifrada });
    if (!veredito.ok) {
      toast({ title: veredito.titulo, description: veredito.mensagem, variant: 'destructive' });
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
  
  /**
   * No Android, abrir a câmera por `<input capture>` é o caminho frágil: o app declara a permissão CAMERA, e nesse
   * caso o sistema exige que ela esteja concedida para o intent de foto funcionar — sem ninguém nunca ter pedido.
   * O resto do app (comentários) já usa o plugin, que pede a permissão na hora. O chat estava fora desse padrão.
   */
  const handleCameraClick = async () => {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) {
      cameraInputRef.current?.click();
      return;
    }
    try {
      const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
      const foto = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Prompt,
        // Foto de conversa não vai para a galeria sem pedirem: o rolo da câmera é compartilhado com o resto do aparelho.
        saveToGallery: false,
      });
      if (!foto.webPath) return;
      const resposta = await fetch(foto.webPath);
      const blob = await resposta.blob();
      const formato = (foto.format || 'jpeg').toLowerCase();
      const arquivo = new File([blob], `camera_${Date.now()}.${formato}`, {
        type: formato === 'png' ? 'image/png' : 'image/jpeg',
      });
      selectFile(arquivo);
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : '';
      // Desistir não é erro.
      if (motivo === 'User cancelled photos app' || motivo === 'No photo selected') return;
      console.error('Camera error:', erro);
      toast({
        title: 'Câmera indisponível',
        description: 'Não deu para abrir a câmera. Confira a permissão do aplicativo e tente de novo.',
        variant: 'destructive',
      });
    }
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
      toast({ title: 'Gravando áudio…', description: 'Toque no quadrado para parar.' });
    } catch (err) {
      console.error("Error accessing microphone:", err);
      toast({ title: 'Microfone bloqueado', description: 'Libere o microfone nas permissões do navegador.', variant: 'destructive' });
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      toast({ title: 'Áudio gravado', description: 'Toque em enviar para mandar.' });
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
    let filePayload: { url: string; type: DirectMessage['fileType']; mediaE2ee?: E2eeMessagePayload | null; posterUrl?: string | null } | undefined;

    try {
      if (fileToSend) {
        setIsUploading(true);
        setProgresso(0);
        try {
          filePayload = await onFileUpload(fileToSend, (p) => setProgresso(Math.max(0, Math.min(100, Math.round(p)))));
        } catch (uploadError) {
          console.error("Failed to upload file:", uploadError);
          // Recusa com motivo que a pessoa precisa saber (cifragem indisponível, sessão trocada): vai como está.
          toast(isUserFacingError(uploadError)
            ? { title: 'Arquivo não enviado', description: uploadError.message, variant: 'destructive' }
            : { title: 'Arquivo não subiu', description: 'Não deu para enviar o arquivo escolhido. Tente de novo.', variant: 'destructive' });
          setMessageText(textToSend);
          setFile(fileToSend);
          setIsSending(false);
          setIsUploading(false);
          return;
        } finally {
          setIsUploading(false);
          setProgresso(0);
        }
      }
      
      await onSendMessage({
        text: textToSend,
        ...(filePayload && {
          fileUrl: filePayload.url,
          fileType: filePayload.type,
          ...(filePayload.mediaE2ee ? { mediaE2ee: filePayload.mediaE2ee } : {}),
          ...(filePayload.posterUrl ? { posterUrl: filePayload.posterUrl } : {}),
        }),
      });
    } catch (error) {
      console.error("Failed to send message:", error);
      setMessageText(textToSend);
      setFile(fileToSend);
      // Recusa com motivo que a pessoa precisa saber (E2EE indisponível, Zero DB sem o contato conectado): o texto volta ao
      // campo e o motivo aparece; qualquer outro erro continua sendo o aviso genérico.
      toast(isUserFacingError(error)
        ? { title: 'Mensagem não enviada', description: error.message, variant: 'destructive' }
        : { title: 'Mensagem não enviada', description: 'Algo deu errado no envio. Tente de novo.', variant: 'destructive' });
    } finally {
      setIsSending(false);
    }
  };

  // Mic quando o campo está vazio, Enviar quando há o que mandar: um só botão naquele canto, sempre o certo.
  const temConteudo = Boolean(messageText.trim() || file);
  const acoesDesligadas = isSending || isUploading || disabled || isRecording;

  return (
    <div
      className="relative min-w-0 shrink-0 border-t border-border bg-background px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
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
              <span className="sr-only">Cancelar resposta</span>
            </Button>
            <p className="text-sm font-semibold text-primary">{replyingTo.sender?.name}</p>
            <p className="text-sm text-muted-foreground truncate">{replyingTo.text || (replyingTo.fileUrl ? 'Anexo' : 'Publicação compartilhada')}</p>
        </div>
      )}
      {file && (
        <div className="mb-2 rounded-xl bg-muted p-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Paperclip className="h-4 w-4 shrink-0" />
              <span className="truncate text-sm">{file.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatarTamanho(file.size)}</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => setFile(null)}
              disabled={isSending}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Tirar o anexo</span>
            </Button>
          </div>
          {/* Envio grande sem sinal nenhum parece travado — e travado parece quebrado. */}
          {isUploading && (
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-background">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-200"
                  style={{ width: `${progresso}%` }}
                />
              </div>
              <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                {progresso}%
              </span>
            </div>
          )}
        </div>
      )}
      {youtubePreview && !file && (
        <YoutubeEmbed videoId={youtubePreview} className="mb-2 max-w-xl" title="Prévia do vídeo do YouTube" />
      )}
      <form
        onSubmit={handleSubmit}
        className="relative flex min-w-0 w-full items-end gap-0.5 rounded-3xl border bg-muted p-1 focus-within:ring-2 focus-within:ring-ring"
      >
        <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/*,video/*,audio/*" />
        <input type="file" capture accept="image/*,video/*" ref={cameraInputRef} onChange={handleFileChange} className="hidden" />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleCameraClick}
          disabled={acoesDesligadas}
          className="h-9 w-9 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
        >
          <Camera className="h-[1.15rem] w-[1.15rem]" />
          <span className="sr-only">Usar câmera</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => fileInputRef.current?.click()}
          disabled={acoesDesligadas}
          className="h-9 w-9 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
        >
          <Paperclip className="h-[1.15rem] w-[1.15rem]" />
          <span className="sr-only">Anexar arquivo</span>
        </Button>
        <Popover open={suggestionsOpen} onOpenChange={setSuggestionsOpen}>
          <PopoverAnchor asChild>
            <Textarea
              id="message-input-area"
              ref={textareaRef}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              onPaste={handlePaste}
              placeholder={isRecording ? 'Gravando áudio…' : 'Digite sua mensagem...'}
              rows={1}
              className="min-w-0 flex-1 resize-none border-none bg-transparent px-1.5 py-2 shadow-none focus-visible:ring-0 min-h-[2.25rem] max-h-[120px]"
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
        {isRecording ? (
          <Button
            type="button"
            size="icon"
            variant="destructive"
            onClick={handleStopRecording}
            className="h-9 w-9 shrink-0 rounded-full"
          >
            <Square className="h-4 w-4 fill-current" />
            <span className="sr-only">Parar gravação</span>
          </Button>
        ) : temConteudo ? (
          <Button
            type="submit"
            size="icon"
            disabled={isSending || isUploading || disabled}
            className="h-9 w-9 shrink-0 rounded-full"
          >
            {isSending ? <Loader2 className="h-[1.15rem] w-[1.15rem] animate-spin" /> : <Send className="h-[1.15rem] w-[1.15rem]" />}
            <span className="sr-only">Enviar mensagem</span>
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleStartRecording}
            disabled={isSending || isUploading || disabled}
            className="h-9 w-9 shrink-0 rounded-full text-primary hover:text-primary"
          >
            <Mic className="h-[1.15rem] w-[1.15rem]" />
            <span className="sr-only">Gravar áudio</span>
          </Button>
        )}
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
