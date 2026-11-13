/* 录音重采样与 PCM 转换单元测试（跨端 MP3 兼容的核心） */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const code = readFileSync(new URL('../js/4-recorder.js', import.meta.url), 'utf8');
const sandbox = { window: {}, console };
vm.createContext(sandbox);
const api = vm.runInContext(
  code +
  '\n;({ resampleForMp3, floatTo16BitPcm, extFor })',
  sandbox
);

test('extFor 识别 MP3/M4A/OGG/WebM', () => {
  assert.equal(api.extFor('audio/mpeg'), 'mp3');
  assert.equal(api.extFor('audio/mp4'), 'm4a');
  assert.equal(api.extFor('audio/ogg'), 'ogg');
  assert.equal(api.extFor('audio/webm'), 'webm');
});

test('floatTo16BitPcm 正确裁剪并量化到 16 位', () => {
  const out = api.floatTo16BitPcm(new Float32Array([0, 1, -1, 0.5, -0.5, 2, -2]));
  assert.deepEqual(Array.from(out), [0, 32767, -32768, 16383, -16384, 32767, -32768]);
});

test('resampleForMp3 48k -> 44.1k 输出长度与连续性正确', () => {
  const session = { inputRate: 48000, targetRate: 44100, resamplePrev: 0, resamplePos: 0 };
  const input = new Float32Array(4800);
  for (let i = 0; i < input.length; i++) input[i] = Math.sin(i / 8);
  const out = api.resampleForMp3(input, session);
  assert.equal(out.length, Math.round(4800 * 44100 / 48000));
  // 无断点：相邻样本差不异常
  for (let i = 1; i < out.length; i++) {
    assert.ok(Math.abs(out[i] - out[i - 1]) < 0.5, `sample ${i} 连续`);
  }
});

test('resampleForMp3 跨块拼接无重复/丢失（两块连起来 = 整体重采样）', () => {
  const whole = new Float32Array(9600);
  for (let i = 0; i < whole.length; i++) whole[i] = Math.sin(i / 20);
  const one = { inputRate: 48000, targetRate: 44100, resamplePrev: 0, resamplePos: 0 };
  const full = api.resampleForMp3(whole, one);

  const two = { inputRate: 48000, targetRate: 44100, resamplePrev: 0, resamplePos: 0 };
  const part1 = api.resampleForMp3(whole.subarray(0, 4800), two);
  const part2 = api.resampleForMp3(whole.subarray(4800), two);
  const joined = new Float32Array(part1.length + part2.length);
  joined.set(part1); joined.set(part2, part1.length);

  assert.equal(joined.length, full.length);
  for (let i = 0; i < full.length; i++) {
    assert.ok(Math.abs(joined[i] - full[i]) < 1e-6, `idx ${i}`);
  }
});

test('采样率一致时原样返回（不做无谓拷贝）', () => {
  const session = { inputRate: 44100, targetRate: 44100, resamplePrev: 0, resamplePos: 0 };
  const input = new Float32Array([0.1, 0.2, 0.3]);
  assert.equal(api.resampleForMp3(input, session), input);
});
