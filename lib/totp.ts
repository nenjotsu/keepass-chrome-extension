const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function decodeBase32(secret: string): Uint8Array {
  const normalized = secret.toUpperCase().replace(/[\s=-]/g, '');
  if (!normalized || !/^[A-Z2-7]+$/.test(normalized)) throw new Error('Enter a valid Base32 TOTP secret.');
  let bits = '';
  for (const character of normalized) bits += BASE32.indexOf(character).toString(2).padStart(5, '0');
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return new Uint8Array(bytes);
}

export async function generateTotp(secret: string, timestamp = Date.now()): Promise<string> {
  const secretBytes = decodeBase32(secret);
  const key = await crypto.subtle.importKey('raw', secretBytes.buffer as ArrayBuffer, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const counter = BigInt(Math.floor(timestamp / 30_000));
  const message = new Uint8Array(8);
  new DataView(message.buffer).setBigUint64(0, counter, false);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 1_000_000).padStart(6, '0');
}
