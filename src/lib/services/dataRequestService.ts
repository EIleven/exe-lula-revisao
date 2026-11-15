// src/lib/services/dataRequestService.ts
// Leitura e escrita dos pedidos de titular. A regra de negócio mora em src/lib/rights/dataRequest.ts (pura e
// testada); aqui fica só a conversa com o Firestore.
'use client';

import { addDoc, collection, getDocs, query, serverTimestamp, where, Timestamp } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import {
  buildDataRequestRecord,
  validateDataRequest,
  type DataRequestKind,
  type DataRequestStatus,
  type IdentityAssurance,
} from '@/lib/rights/dataRequest';

const COLLECTION = 'dataRequests';

export interface DataRequestView {
  id: string;
  kind: DataRequestKind;
  message: string;
  status: DataRequestStatus;
  assurance: IdentityAssurance;
  createdAtMs: number;
  response?: string;
  respondedAtMs?: number;
}

/**
 * Abre um pedido. Devolve o id, de onde a interface deriva o protocolo — não guardamos um campo de protocolo porque
 * ele é calculável, e campo a mais é dado a mais.
 */
export async function createDataRequest(kind: string, message?: string): Promise<string> {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error('Entre na sua conta para abrir um pedido.');

  const validacao = validateDataRequest({ kind, message });
  if (!validacao.ok) {
    throw new Error(
      validacao.reason === 'tipo-invalido' ? 'Escolha um tipo de pedido.' : 'A descrição ficou longa demais.',
    );
  }

  const registro = buildDataRequestRecord(userId, validacao.kind, validacao.message);
  const docRef = await addDoc(collection(db, COLLECTION), {
    ...registro,
    // A regra exige `request.time`: a data é do servidor, não do aparelho.
    createdAt: serverTimestamp(),
  });
  return docRef.id;
}

const millisOf = (value: unknown): number | undefined =>
  value instanceof Timestamp ? value.toMillis() : undefined;

/** Os pedidos de quem está logado. Ordenados aqui, no cliente: são poucos, e assim não exige índice composto. */
export async function listMyDataRequests(): Promise<DataRequestView[]> {
  const userId = auth.currentUser?.uid;
  if (!userId) return [];

  const snapshot = await getDocs(query(collection(db, COLLECTION), where('userId', '==', userId)));
  const pedidos = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      kind: data.kind as DataRequestKind,
      message: (data.message as string) ?? '',
      status: (data.status as DataRequestStatus) ?? 'recebido',
      assurance: (data.assurance as IdentityAssurance) ?? 'conta-autenticada',
      createdAtMs: millisOf(data.createdAt) ?? Date.now(),
      response: (data.response as string) || undefined,
      respondedAtMs: millisOf(data.respondedAt),
    };
  });
  return pedidos.sort((a, b) => b.createdAtMs - a.createdAtMs);
}
