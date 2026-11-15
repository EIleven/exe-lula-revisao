// src/components/shared/MountOnceOpened.tsx
'use client';

import React, { useState } from 'react';

interface MountOnceOpenedProps {
  open: boolean;
  children: React.ReactNode;
}

/**
 * Monta `children` só depois da PRIMEIRA vez em que `open` fica verdadeiro, e os mantém montados daí em diante (o texto
 * digitado e o resto do estado do diálogo sobrevivem a fechar e abrir de novo, como antes).
 *
 * Existe por causa do feed: cada cartão trazia, sempre montados e fechados, sete diálogos (compartilhar, enviar por mensagem,
 * citar, editar, estatísticas, visualizador de imagem, aviso de login), cada um com seus ganchos, ouvintes e até uma
 * leitura ao servidor (as estatísticas do post eram buscadas para TODO cartão que aparecia). Com 60 cartões eram 400 diálogos
 * invisíveis. Agora só existem os que alguém abriu.
 */
export default function MountOnceOpened({ open, children }: MountOnceOpenedProps) {
  const [wasOpened, setWasOpened] = useState(open);
  if (open && !wasOpened) setWasOpened(true);
  return wasOpened ? <>{children}</> : null;
}
