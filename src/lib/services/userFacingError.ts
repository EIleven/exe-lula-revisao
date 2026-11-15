// src/lib/services/userFacingError.ts
// Erro cuja mensagem PODE e DEVE ser mostrada à pessoa como está. Quem envia mensagem lança isto quando a recusa tem motivo
// que ela precisa saber (ex.: "este aparelho não tem a chave E2EE"); o campo de mensagem restaura o texto digitado e mostra
// o motivo, em vez do aviso genérico. Qualquer outro erro continua virando o aviso genérico (detalhe técnico não vai à tela).
export class UserFacingSendError extends Error {
  readonly userFacing = true as const;

  constructor(message: string) {
    super(message);
    this.name = 'UserFacingSendError';
  }
}

export const isUserFacingError = (e: unknown): e is UserFacingSendError =>
  e instanceof Error && (e as { userFacing?: unknown }).userFacing === true;
