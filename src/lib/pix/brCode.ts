/**
 * Gerador de BR Code Pix (padrão EMV QRCPS-MPM do Banco Central do Brasil).
 * Gera o código "Pix Copia e Cola" e o conteúdo do QR Code 100% no cliente.
 */

export interface PixPayloadInput {
  pixKey: string;
  merchantName: string;
  merchantCity?: string | null;
  amount?: number | null;
  description?: string | null;
  txid?: string;
}

function normalizeAscii(value: string, maxLen: number): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function emvField(id: string, value: string): string {
  const len = String(value.length).padStart(2, '0');
  return `${id}${len}${value}`;
}

function crc16Ccitt(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function generatePixPayload({
  pixKey,
  merchantName,
  merchantCity,
  amount,
  description,
  txid = '***',
}: PixPayloadInput): string {
  const cleanKey = pixKey.trim();
  if (!cleanKey) return '';

  const name = normalizeAscii(merchantName || 'Apoiador', 25) || 'Apoiador';
  const city = normalizeAscii(merchantCity || 'Brasil', 15) || 'Brasil';
  const cleanDesc = description ? normalizeAscii(description, 40) : '';
  const cleanTxid = normalizeAscii(txid, 25).replace(/\s/g, '') || '***';

  const merchantAccountInfo = [
    emvField('00', 'br.gov.bcb.pix'),
    emvField('01', cleanKey),
    ...(cleanDesc ? [emvField('02', cleanDesc)] : []),
  ].join('');

  const amountStr =
    typeof amount === 'number' && Number.isFinite(amount) && amount > 0
      ? amount.toFixed(2)
      : '';

  const additionalData = emvField('05', cleanTxid);

  const withoutCrc = [
    emvField('00', '01'),
    emvField('26', merchantAccountInfo),
    emvField('52', '0000'),
    emvField('53', '986'),
    ...(amountStr ? [emvField('54', amountStr)] : []),
    emvField('58', 'BR'),
    emvField('59', name),
    emvField('60', city),
    emvField('62', additionalData),
    '6304',
  ].join('');

  return `${withoutCrc}${crc16Ccitt(withoutCrc)}`;
}

export function describePixKeyType(pixKey: string): string {
  const trimmed = pixKey.trim();
  if (!trimmed) return 'Chave Pix';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    return 'Chave aleatória';
  }
  if (trimmed.includes('@')) return 'E-mail';
  if (/^\+?55?\d{10,11}$/.test(trimmed.replace(/[\s()-]/g, '')) && trimmed.startsWith('+')) {
    return 'Telefone';
  }
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 11) return 'CPF / Telefone';
  if (digits.length === 14) return 'CNPJ';
  return 'Chave Pix';
}

