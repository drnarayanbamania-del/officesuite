const MAGIC = new TextEncoder().encode('NOVAENC1');

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: 210000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptBytes(bytes: ArrayBuffer, password: string): Promise<ArrayBuffer> {
  if (password.length < 6) throw new Error('Use a password with at least 6 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as unknown as BufferSource }, key, bytes)
  );
  const out = new Uint8Array(MAGIC.length + salt.length + iv.length + cipher.length);
  out.set(MAGIC, 0);
  out.set(salt, MAGIC.length);
  out.set(iv, MAGIC.length + salt.length);
  out.set(cipher, MAGIC.length + salt.length + iv.length);
  return out.buffer as ArrayBuffer;
}

export async function decryptBytes(bytes: ArrayBuffer, password: string): Promise<ArrayBuffer> {
  const view = new Uint8Array(bytes);
  if (view.length < MAGIC.length + 28) throw new Error('This is not an Office Suite encrypted file.');
  for (let i = 0; i < MAGIC.length; i++) {
    if (view[i] !== MAGIC[i]) throw new Error('This is not an Office Suite encrypted file.');
  }
  const salt = view.slice(MAGIC.length, MAGIC.length + 16);
  const iv = view.slice(MAGIC.length + 16, MAGIC.length + 28);
  const cipher = view.slice(MAGIC.length + 28);
  try {
    const key = await deriveKey(password, salt);
    return await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as unknown as BufferSource }, key, cipher);
  } catch {
    throw new Error('Wrong password, or the file has been altered.');
  }
}
