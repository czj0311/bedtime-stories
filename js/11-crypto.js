/* ===== 端到端加密（E2E）=====
   双人密钥只在本设备内存中存在；云端仅保存密文与 IV。
   - 登录密码（Supabase Auth）与故事口令（恢复短语）相互独立。
   - 恢复短语 --PBKDF2--> 包裹密钥 --> 解开 256 位双人密钥。
   - 双人密钥加密一切内容：标题/留言（AES-GCM + 文本）与录音（AES-GCM + 字节）。
   - 云端永远拿不到明文密钥与恢复短语；短语遗忘后内容无法找回。 */
const BedtimeCrypto = (() => {
  const subtle = () => {
    if (typeof crypto !== 'undefined' && crypto.subtle) return crypto.subtle;
    throw new Error('此设备不支持 Web 加密，无法使用双人加密同步');
  };

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const PBKDF2_ITERATIONS = 310000; // 默认迭代次数，随 vault 元数据存云端
  const IV_LEN = 12;                // AES-GCM 推荐 96 位 IV

  function isSupported() {
    return typeof crypto !== 'undefined'
      && !!crypto.subtle
      && typeof crypto.getRandomValues === 'function'
      && (typeof crypto.randomUUID === 'function' || typeof uid === 'function');
  }

  /* ---- base64（ArrayBuffer <-> string，浏览器兼容） ---- */
  function b64FromBytes(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }
  function bytesFromB64(str) {
    const binary = atob(str);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  function randomBytes(n) {
    const b = new Uint8Array(n);
    crypto.getRandomValues(b);
    return b;
  }
  function randomIv() { return b64FromBytes(randomBytes(IV_LEN)); }
  function randomUuid() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return (typeof uid === 'function' ? uid() : null);
  }

  /* ---- 口令强度：恢复短语必须足够强，防止简单猜测 ---- */
  function passStrength(pw) {
    if (typeof pw !== 'string') pw = '';
    if (pw.length < 10) return { ok: false, msg: '至少 10 个字符，建议 4 个以上随机词语' };
    if (/^(\d{6}|\d{8}|(\d)\2{5,})$/.test(pw)) return { ok: false, msg: '不要使用生日或重复数字' };
    if (pw.length >= 16) return { ok: true, msg: '强度很好' };
    if (/^(.)\1+$/.test(pw)) return { ok: false, msg: '不要使用重复字符' };
    const classes = (/[a-z]/.test(pw) ? 1 : 0) + (/[A-Z]/.test(pw) ? 1 : 0)
      + (/\d/.test(pw) ? 1 : 0) + (/[\u4e00-\u9fff]/.test(pw) ? 1 : 0)
      + (/[^\w\s\u4e00-\u9fff]/.test(pw) ? 1 : 0);
    if (pw.length >= 12 && classes >= 1) return { ok: true, msg: '强度合格' };
    return { ok: false, msg: '再长一些，或混合字母、数字、符号' };
  }

  /* ---- PBKDF2：恢复短语 -> 包裹密钥 ---- */
  async function deriveWrapKey(passphrase, saltB64, iterations) {
    const base = await subtle().importKey(
      'raw', encoder.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']
    );
    const bits = await subtle().deriveBits(
      { name: 'PBKDF2', salt: bytesFromB64(saltB64), iterations, hash: 'SHA-256' },
      base, 256
    );
    return subtle().importKey('raw', bits, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  /* ---- 双人密钥：生成 + 包裹 ---- */
  async function wrapCoupleKey(passphrase, iterations) {
    const salt = b64FromBytes(randomBytes(16));
    const iters = iterations || PBKDF2_ITERATIONS;
    const wrapKey = await deriveWrapKey(passphrase, salt, iters);
    const rawKey = randomBytes(32);
    const iv = randomIv();
    const wrapped = await subtle().encrypt(
      { name: 'AES-GCM', iv: bytesFromB64(iv) }, wrapKey, rawKey
    );
    const coupleKey = await subtle().importKey(
      'raw', rawKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
    return {
      key: coupleKey,
      vault: { salt, iterations: iters, wrappedKey: b64FromBytes(wrapped), iv, version: 1 }
    };
  }

  async function unwrapCoupleKey(vault, passphrase) {
    const wrapKey = await deriveWrapKey(passphrase, vault.salt, vault.iterations);
    let raw;
    try {
      raw = await subtle().decrypt(
        { name: 'AES-GCM', iv: bytesFromB64(vault.iv) }, wrapKey, bytesFromB64(vault.wrappedKey)
      );
    } catch (e) {
      const err = new Error('恢复短语不正确');
      err.code = 'BAD_PASSPHRASE';
      throw err;
    }
    return subtle().importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  /* ---- 文本/JSON 加密 ---- */
  async function encryptJson(key, obj) {
    const plain = encoder.encode(JSON.stringify(obj));
    const iv = randomIv();
    const cipher = await subtle().encrypt({ name: 'AES-GCM', iv: bytesFromB64(iv) }, key, plain);
    return { cipher: b64FromBytes(cipher), iv };
  }
  async function decryptJson(key, cipherB64, ivB64) {
    const plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: bytesFromB64(ivB64) }, key, bytesFromB64(cipherB64)
    );
    return JSON.parse(decoder.decode(plain));
  }

  /* ---- 音频字节加密：cipher 为 ArrayBuffer，可直接上传 ---- */
  async function encryptBytes(key, buffer) {
    const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const iv = randomIv();
    const cipher = await subtle().encrypt({ name: 'AES-GCM', iv: bytesFromB64(iv) }, key, data);
    return { cipher, iv };
  }
  async function decryptBytes(key, cipherBuf, ivB64) {
    return subtle().decrypt(
      { name: 'AES-GCM', iv: bytesFromB64(ivB64) }, key, cipherBuf
    );
  }

  return {
    isSupported, b64FromBytes, bytesFromB64, randomIv, randomUuid,
    passStrength, PBKDF2_ITERATIONS,
    deriveWrapKey, wrapCoupleKey, unwrapCoupleKey,
    encryptJson, decryptJson, encryptBytes, decryptBytes
  };
})();
