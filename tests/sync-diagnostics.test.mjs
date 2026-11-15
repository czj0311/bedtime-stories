/* 静态回归测试：确保「上传同步失败」与「设备/网络差异」的修复不会被改回去。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(path.join(root, p), 'utf8');

test('stories 的 INSERT 列授权包含主键 id', () => {
  const sql = read('supabase/schema.sql');
  const m = sql.match(/grant insert \(([\s\S]*?)\) on table public\.stories/i);
  assert.ok(m, '找不到 stories 的 INSERT 授权');
  for (const col of ['id', 'couple_id', 'author_id', 'content_cipher', 'content_iv', 'audio_path', 'audio_iv', 'mime', 'duration', 'byte_size']) {
    assert.match(m[1], new RegExp('\\b' + col + '\\b'), `INSERT 授权缺少列 ${col}`);
  }
});

test('一次性补丁确实补齐 id 权限并带验证查询', () => {
  const patch = read('supabase/patch-grants.sql');
  assert.match(patch, /grant insert \(id\) on table public\.stories/i);
  assert.match(patch, /has_column_privilege/);
});

test('Service Worker 对应用外壳网络优先，config.js 强制 no-store', () => {
  const sw = read('sw.js');
  assert.match(sw, /网络优先|network.first/i);
  assert.match(sw, /cache:\s*'no-store'/);
  assert.match(sw, /bedtime-stories-v5/);
  assert.match(sw, /js\/14-diagnostics\.js/);
});

test('外部字体不再阻塞渲染，诊断模块已接入', () => {
  const html = read('index.html');
  assert.match(html, /media="print" onload="this\.media='all'"/);
  assert.match(html, /js\/14-diagnostics\.js/);
  assert.match(html, /id="acctDiagBtn"/);
});

test('上传链路的失败环节有可区分的编号与错误记录', () => {
  const cloud = read('js/12-cloud.js');
  assert.match(cloud, /① 本机加密失败/);
  assert.match(cloud, /② 音频上传失败/);
  assert.match(cloud, /③ 故事记录写入失败/);
  assert.match(cloud, /recordError\(/);
  assert.match(cloud, /getLastError/);
  assert.match(cloud, /forceSync/);
});

test('诊断面板覆盖 Auth / REST / Storage 与可逆写入探针', () => {
  const diag = read('js/14-diagnostics.js');
  for (const s of ['/auth/v1/health', '/rest/v1/couples', '/storage/v1/bucket', 'stories INSERT', 'Storage 上传']) {
    assert.ok(diag.includes(s), `诊断面板缺少 ${s} 检查`);
  }
  assert.match(diag, /\.delete\(\)\.eq\('id', id\)/, '写入探针必须删除测试数据');
  assert.match(diag, /remove\(\[path\]\)/, 'Storage 探针必须删除测试文件');
});
