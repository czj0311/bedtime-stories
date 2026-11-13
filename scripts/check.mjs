/* 项目静态自检：引用完整性、密钥卫生、构建产物 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = p => readFileSync(path.join(root, p), 'utf8');
const exists = p => existsSync(path.join(root, p));

const problems = [];
const ok = (cond, msg) => { if (!cond) problems.push(msg); };

// 1. index.html 引用的本地脚本/样式全部存在
const html = read('index.html');
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1])
  .filter(u => !u.startsWith('http') && !u.startsWith('data:'));
for (const ref of refs) ok(exists(ref), `index.html 引用缺失：${ref}`);

// 2. sw.js 缓存清单中的文件全部存在
const sw = read('sw.js');
for (const u of sw.matchAll(/'\.\/([^']+)'/g)) {
  if (u[1].trim() === '') continue;
  ok(exists(u[1] === '' ? '.' : u[1] === '' ? './' : u[1]), `sw.js 缓存缺失：${u[1]}`);
}

// 3. 加密与云端层均已接入页面
ok(html.includes('vendor/runtime.js'), '缺少 vendor/runtime.js 脚本引用');
ok(html.includes('js/11-crypto.js'), '缺少加密模块引用');
ok(html.includes('js/12-cloud.js'), '缺少云端模块引用');
ok(html.includes('js/13-account.js'), '缺少账号模块引用');

// 4. 密钥卫生：config 占位为空、任何文件不含真实密钥特征
const config = read('js/config.js');
const url = config.match(/SUPABASE_URL:\s*'([^']*)'/)[1];
const key = config.match(/SUPABASE_ANON_KEY:\s*'([^']*)'/)[1];
ok(url === '' && key === '', 'js/config.js 中的占位值应为空字符串');

// 5. 密钥卫生：剔除注释后，正文不应包含 service_role / JWT 形态真实密钥
const stripComments = (c, sql) => sql
  ? c.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  : c.replace(/^\s*\/\/[^\n]*/gm, '').replace(/^\s*\/\*[\s\S]*?\*\//g, '').replace(/\/\*[\s\S]*?\*\//g, '');
for (const f of ['js/config.js', 'supabase/schema.sql', 'index.html', 'js/12-cloud.js']) {
  const c = stripComments(read(f), f.endsWith('.sql'));
  ok(!c.includes('service_role'), `${f} 不应包含 service_role 字样`);
  ok(!/eyJ[A-Za-z0-9_-]{20,}/.test(c), `${f} 不应包含 JWT 形态的真实密钥`);
}

// 5. SQL 脚本安全要点
const sql = read('supabase/schema.sql');
for (const must of [
  'enable row level security',
  'story-audio',
  'is_couple_member',
  'create_couple',
  'join_couple',
  'supabase_realtime'
]) ok(sql.includes(must), `supabase/schema.sql 缺少：${must}`);

// 6. 构建产物存在且体积合理（lamejs + supabase-js 打包）
ok(exists('vendor/runtime.js'), '缺少 vendor/runtime.js 构建产物');
if (exists('vendor/runtime.js')) {
  const size = statSync(path.join(root, 'vendor/runtime.js')).size;
  ok(size > 150000, `vendor/runtime.js 体积异常（${size} bytes）`);
  const v = read('vendor/runtime.js');
  ok(v.includes('Mp3Encoder') || v.includes('lame'), 'vendor 中未找到 MP3 编码器');
  ok(v.includes('createClient') || v.includes('supabase'), 'vendor 中未找到 Supabase 客户端');
}

// 7. 录音模块已切换为 MP3 统一输出
const rec = read('js/4-recorder.js');
ok(rec.includes("mime: 'audio/mpeg'"), '录音输出应为 audio/mpeg');
ok(!rec.includes('MediaRecorder'), '不应再依赖 MediaRecorder（跨端格式不一致）');

// 8. 双人界面元素存在
for (const id of ['accountMask', 'cloudChip', 'accountBtn', 'acctBody']) {
  ok(html.includes(`id="${id}"`), `index.html 缺少元素 #${id}`);
}
const css = read('styles.css');
ok(css.includes('.cloud-chip'), 'styles.css 缺少 cloud-chip 样式');

if (problems.length) {
  console.error('自检未通过：');
  for (const p of problems) console.error(' - ' + p);
  process.exit(1);
} else {
  console.log('自检通过：引用、密钥卫生、SQL 安全、构建产物、MP3 统一输出、双人界面均就绪。');
}
