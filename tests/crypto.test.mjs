/* 端到端加密模块单元测试（Node 22 自带 WebCrypto） */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const code = readFileSync(new URL('../js/11-crypto.js', import.meta.url), 'utf8');
const sandbox = {
  btoa, atob,
  TextEncoder, TextDecoder,
  crypto: globalThis.crypto
};
vm.createContext(sandbox);
const BedtimeCrypto = vm.runInContext(code + '\n;BedtimeCrypto', sandbox);

test('isSupported 在 Node/浏览器环境为 true', () => {
  assert.equal(BedtimeCrypto.isSupported(), true);
});

test('passStrength 拒绝生日、重复数字与过短口令', () => {
  assert.equal(BedtimeCrypto.passStrength('123456').ok, false);
  assert.equal(BedtimeCrypto.passStrength('2008080').ok, false);
  assert.equal(BedtimeCrypto.passStrength('aaaaaaaaaa').ok, false);
  assert.equal(BedtimeCrypto.passStrength('短').ok, false);
  assert.equal(BedtimeCrypto.passStrength('月亮 轻轻 藏进 云朵 里').ok, true);
});

test('wrapCoupleKey/unwrapCoupleKey 正确口令可还原，错误口令报 BAD_PASSPHRASE', async () => {
  const { key, vault } = await BedtimeCrypto.wrapCoupleKey('月亮 轻轻 藏进 云朵 里');
  const restored = await BedtimeCrypto.unwrapCoupleKey(vault, '月亮 轻轻 藏进 云朵 里');
  assert.ok(restored instanceof CryptoKey);
  await assert.rejects(
    BedtimeCrypto.unwrapCoupleKey(vault, '错误口令错误口令错误口令'),
    e => e.code === 'BAD_PASSPHRASE'
  );
});

test('vault 中不包含明文密钥材料', async () => {
  const { vault } = await BedtimeCrypto.wrapCoupleKey('苹果 星星 微风 河流 尾声');
  const json = JSON.stringify(vault);
  assert.ok(!json.includes('raw'));
  assert.equal(vault.wrappedKey.length > 40, true);
  assert.equal(vault.iv.length > 8, true);
});

test('encryptJson/decryptJson 中文内容往返一致', async () => {
  const { key } = await BedtimeCrypto.wrapCoupleKey('苹果 星星 微风 河流 尾声');
  const obj = { t: '第三夜·小熊看月亮', n: '念给你听 🌙' };
  const enc = await BedtimeCrypto.encryptJson(key, obj);
  assert.equal(typeof enc.cipher, 'string');
  const dec = await BedtimeCrypto.decryptJson(key, enc.cipher, enc.iv);
  assert.equal(dec.t, obj.t);
  assert.equal(dec.n, obj.n);
});

test('同一内容两次加密产生不同密文与 IV（随机 IV）', async () => {
  const { key } = await BedtimeCrypto.wrapCoupleKey('苹果 星星 微风 河流 尾声');
  const obj = { t: 'a', n: 'b' };
  const e1 = await BedtimeCrypto.encryptJson(key, obj);
  const e2 = await BedtimeCrypto.encryptJson(key, obj);
  assert.notEqual(e1.iv, e2.iv);
  assert.notEqual(e1.cipher, e2.cipher);
});

test('encryptBytes/decryptBytes 音频字节往返一致', async () => {
  const { key } = await BedtimeCrypto.wrapCoupleKey('苹果 星星 微风 河流 尾声');
  const pcm = new Uint8Array(4096);
  for (let i = 0; i < pcm.length; i++) pcm[i] = (i * 7 + 13) & 0xff;
  const enc = await BedtimeCrypto.encryptBytes(key, pcm);
  const dec = new Uint8Array(await BedtimeCrypto.decryptBytes(key, enc.cipher, enc.iv));
  assert.deepEqual(dec, pcm);
});

test('base64 工具与随机 IV 编码往返一致', () => {
  const b = BedtimeCrypto.bytesFromB64(BedtimeCrypto.b64FromBytes(new Uint8Array([1, 2, 250])));
  assert.deepEqual(Array.from(b), [1, 2, 250]);
  assert.notEqual(BedtimeCrypto.randomIv(), BedtimeCrypto.randomIv());
});

test('错误密钥解密必须失败（AES-GCM 认证）', async () => {
  const a = await BedtimeCrypto.wrapCoupleKey('苹果 星星 微风 河流 尾声');
  const b = await BedtimeCrypto.wrapCoupleKey('香蕉 云朵 山谷 灯塔 清晨');
  const enc = await BedtimeCrypto.encryptJson(a.key, { t: 'x' });
  await assert.rejects(BedtimeCrypto.decryptJson(b.key, enc.cipher, enc.iv));
});
