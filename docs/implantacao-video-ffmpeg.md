# Implantação do pipeline de vídeo FFmpeg

O pipeline não usa Google Transcoder. O software de processamento é o FFmpeg, executado em um Cloud Run Job que
escala a zero. O Google continua cobrando apenas a infraestrutura consumida (CPU, armazenamento e tráfego), não uma
tarifa proprietária por minuto de transcodificação.

## Ordem obrigatória

1. Criar as duas contas de serviço e os vínculos mínimos de IAM.
2. Criar/atualizar o Job `video-transcoder` com o volume GCSFuse.
3. Publicar `storage.rules` (o navegador precisa poder enviar para `video_staging/`).
4. Publicar nominalmente as Functions do pipeline e da limpeza de mídia listadas abaixo.
5. Publicar o site.
6. Testar um vídeo curto em post, comentário, quote, chat e Arquivos.
7. Confirmar: fonte transitória apagada, saída MP4 sem token, `/m` público e `/mp` privado.

Nunca publicar todas as Functions: isso pode propor exclusão de funções que não estão no checkout corrente, inclusive as
agentes Mariana. O conjunto nominal desta implantação é:

```powershell
firebase deploy --project echo-b5aw9 --only `
  functions:onVideoSourceUploaded,functions:dispatchQueuedVideoTranscodes,functions:onPostDeleted,functions:onPostUpdated,functions:onCommentDeleted,functions:onCommentUpdated,functions:onDirectMessageDeleted,functions:onUserUpdated,functions:onUserDeletedCleanup
```

Logo depois deste deploy, conceda o papel de invocação ao serviço do gatilho (só ele, nunca no projeto inteiro):

```powershell
gcloud run services add-iam-policy-binding onvideosourceuploaded --region southamerica-east1 --project echo-b5aw9 `
  --member serviceAccount:video-dispatcher@echo-b5aw9.iam.gserviceaccount.com --role roles/run.invoker
```

Antes do deploy há 40 Functions. Este conjunto adiciona quatro (`onVideoSourceUploaded`,
`dispatchQueuedVideoTranscodes`, `onCommentUpdated` e `onDirectMessageDeleted`) e atualiza cinco. Depois devem existir 44,
com `agentMarianaPublisher` e `agentMarianaResponder` ainda presentes.

## Infraestrutura

Projeto `echo-b5aw9`, região `southamerica-east1`, banco `echo-db-124325`, bucket
`echo-b5aw9.firebasestorage.app`.

Contas:

- `video-transcoder@echo-b5aw9.iam.gserviceaccount.com`: `roles/datastore.user` e
  `roles/storage.objectAdmin`;
- `video-dispatcher@echo-b5aw9.iam.gserviceaccount.com`: `roles/datastore.user`,
  `roles/eventarc.eventReceiver`, `roles/run.invoker` **somente no serviço `onvideosourceuploaded`** (concedido depois
  do passo 4, porque o serviço só existe após o deploy da Function) e papel customizado apenas para executar o job com
  o `VIDEO_MEDIA_ID` (sem permissão para editar o job).

> **Sem o `run.invoker` o vídeo nunca sai de "processando".** O Eventarc entrega o evento do Storage ao serviço Cloud Run
> da Function usando esta conta; sem o papel, o Cloud Run recusa com `run.routes.invoke` e o Job não é disparado (nenhuma
> execução). Foi o que a validação em produção de 2026-11-12 encontrou.

O índice composto `videoUploads(status ASC, createdAt ASC)` precisa estar em estado `READY` antes da publicação. Ele
permite ao varredor recuperar jobs enfileirados sem varrer a coleção inteira.

Preparação única (com uma conta administradora do projeto):

```powershell
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com `
  eventarc.googleapis.com cloudscheduler.googleapis.com --project echo-b5aw9
gcloud iam service-accounts create video-transcoder --project echo-b5aw9
gcloud iam service-accounts create video-dispatcher --project echo-b5aw9
gcloud projects add-iam-policy-binding echo-b5aw9 `
  --member serviceAccount:video-transcoder@echo-b5aw9.iam.gserviceaccount.com --role roles/datastore.user
gcloud storage buckets add-iam-policy-binding gs://echo-b5aw9.firebasestorage.app `
  --member serviceAccount:video-transcoder@echo-b5aw9.iam.gserviceaccount.com --role roles/storage.objectAdmin
gcloud projects add-iam-policy-binding echo-b5aw9 `
  --member serviceAccount:video-dispatcher@echo-b5aw9.iam.gserviceaccount.com --role roles/datastore.user
gcloud projects add-iam-policy-binding echo-b5aw9 `
  --member serviceAccount:video-dispatcher@echo-b5aw9.iam.gserviceaccount.com --role roles/eventarc.eventReceiver
gcloud iam roles create videoJobDispatcher --project echo-b5aw9 --stage GA `
  --title "Video Job Dispatcher" `
  --permissions run.jobs.run,run.jobs.runWithOverrides,run.executions.get
gcloud projects add-iam-policy-binding echo-b5aw9 `
  --member serviceAccount:video-dispatcher@echo-b5aw9.iam.gserviceaccount.com `
  --role projects/echo-b5aw9/roles/videoJobDispatcher
```

Se uma conta já existir, o comando de criação apenas deve ser pulado; não a recrie nem troque suas chaves.

Job (executar na raiz do repositório):

```powershell
gcloud run jobs deploy video-transcoder `
  --source video-worker `
  --project echo-b5aw9 `
  --region southamerica-east1 `
  --service-account video-transcoder@echo-b5aw9.iam.gserviceaccount.com `
  --cpu 4 --memory 4Gi --task-timeout 4h --max-retries 2 `
  --add-volume name=media,type=cloud-storage,bucket=echo-b5aw9.firebasestorage.app `
  --add-volume-mount volume=media,mount-path=/mnt/media `
  --set-env-vars FIRESTORE_DATABASE_ID=echo-db-124325,STORAGE_BUCKET=echo-b5aw9.firebasestorage.app,MEDIA_MOUNT=/mnt/media
```

Aplicar ciclo de vida somente depois de guardar a configuração atual do bucket. O arquivo
`video-worker/staging-lifecycle.json` apaga fontes interrompidas com mais de dois dias; não toca em `user_uploads/`.

```powershell
gcloud storage buckets describe gs://echo-b5aw9.firebasestorage.app --format=json > bucket-antes-video.json
gcloud storage buckets update gs://echo-b5aw9.firebasestorage.app `
  --lifecycle-file video-worker/staging-lifecycle.json
firebase deploy --project echo-b5aw9 --only storage
```

## Validação em produção

Após publicar as Functions e o site, execute a validação destrutiva-controlada. Ela cria três contas descartáveis por API
administrativa, testa o fluxo real e as remove no bloco de reversão, inclusive quando há falha ou interrupção:

```powershell
$env:GCLOUD_ACCOUNT = 'conta-administradora@exemplo.com'
node scripts/validar-video-producao.mjs --producao
```

Não use `--manter` numa validação normal. O parâmetro existe somente para investigação assistida e desliga
explicitamente a reversão automática.

## Perfil produzido

- contêiner MP4;
- vídeo H.264, `yuv420p`, CRF 23, teto de 5 Mbit/s, no máximo 30 fps;
- áudio AAC estéreo 128 kbit/s / 48 kHz;
- até 1920×1080, sem ampliar fonte menor, preservando proporção e rotação;
- `faststart` para reprodução progressiva;
- duração máxima: 10.200 segundos (2h50), validada novamente pelo FFprobe.

O upload não tem teto arbitrário de MB. A publicação recebe a URL própria imediatamente e mostra o estado de
processamento; falhas de capacidade ficam na fila, sem pedir novo upload.
