// Helper: ArrayBuffer to Standard Base64
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// Helper: Standard Base64 to ArrayBuffer
function base64ToArrayBuffer(base64) {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// Helper: ArrayBuffer to URL-Safe Base64
function bufferToBase64Url(buffer) {
  const base64 = arrayBufferToBase64(buffer);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Helper: URL-Safe Base64 to ArrayBuffer
function base64UrlToBuffer(base64url) {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return base64ToArrayBuffer(base64);
}

/**
 * Generates a random 256-bit AES-GCM key and returns it as a URL-safe Base64 string.
 */
export async function generateKey() {
  const key = await window.crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true, // extractable
    ["encrypt", "decrypt"]
  );
  
  const rawKey = await window.crypto.subtle.exportKey("raw", key);
  return bufferToBase64Url(rawKey);
}

/**
 * Imports a CryptoKey object from its URL-safe Base64 string representation.
 */
export async function importKey(keyStr) {
  const rawKeyBytes = base64UrlToBuffer(keyStr);
  return await window.crypto.subtle.importKey(
    "raw",
    rawKeyBytes,
    {
      name: "AES-GCM",
    },
    false, // not extractable
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts cleartext string using the CryptoKey.
 * Returns { iv: base64url, ciphertext: base64url }
 */
export async function encryptText(text, cryptoKey) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const iv = window.crypto.getRandomValues(new Uint8Array(12)); // AES-GCM standard IV size is 12 bytes
  
  const encrypted = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    cryptoKey,
    data
  );

  return {
    iv: bufferToBase64Url(iv),
    ciphertext: bufferToBase64Url(encrypted),
  };
}

/**
 * Decrypts ciphertext back to string using the CryptoKey and IV.
 */
export async function decryptText(ivStr, ciphertextStr, cryptoKey) {
  const iv = new Uint8Array(base64UrlToBuffer(ivStr));
  const ciphertext = base64UrlToBuffer(ciphertextStr);

  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    cryptoKey,
    ciphertext
  );

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

/**
 * Encrypts a File object by compiling its metadata and data.
 * Returns { iv, ciphertext } containing the encrypted JSON string of file details.
 */
export async function encryptFile(file, cryptoKey) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const fileBuffer = reader.result;
        const payload = {
          name: file.name,
          type: file.type,
          data: arrayBufferToBase64(fileBuffer)
        };
        const encrypted = await encryptText(JSON.stringify(payload), cryptoKey);
        resolve(encrypted);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Decrypts an encrypted file payload and returns { name, type, blob }
 */
export async function decryptFile(ivStr, ciphertextStr, cryptoKey) {
  const jsonStr = await decryptText(ivStr, ciphertextStr, cryptoKey);
  const payload = JSON.parse(jsonStr);
  const fileBuffer = base64ToArrayBuffer(payload.data);
  const blob = new Blob([fileBuffer], { type: payload.type });
  
  return {
    name: payload.name,
    type: payload.type,
    blob: blob,
    url: URL.createObjectURL(blob)
  };
}
