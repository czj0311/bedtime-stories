/* ===== 波形 + 星空（Canvas） ===== */
const waveCanvas = $('#waveCanvas');
const wctx = waveCanvas.getContext('2d');
let waveW = 0, waveH = 0, waveT = 0;

function fitWave() {
  const r = waveCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  waveW = r.width; waveH = r.height;
  waveCanvas.width = Math.max(1, Math.round(waveW * dpr));
  waveCanvas.height = Math.max(1, Math.round(waveH * dpr));
  wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawIdleWave() {
  wctx.clearRect(0, 0, waveW, waveH);
  wctx.lineWidth = 1.5;
  wctx.strokeStyle = 'rgba(238,216,169,0.35)';
  wctx.beginPath();
  const mid = waveH / 2;
  for (let x = 0; x <= waveW; x += 4) {
    const y = mid + Math.sin((x / waveW) * Math.PI * 2 * 1.3 + waveT) * 6
                  + Math.sin((x / waveW) * Math.PI * 4 + waveT * 1.4) * 2.5;
    if (x === 0) wctx.moveTo(x, y); else wctx.lineTo(x, y);
  }
  wctx.stroke();
}

function drawLiveWave() {
  const analyser = rec.analyser;
  if (!analyser) { drawIdleWave(); return; }
  wctx.clearRect(0, 0, waveW, waveH);
  const n = analyser.fftSize;
  const data = new Uint8Array(n);
  analyser.getByteTimeDomainData(data);
  const mid = waveH / 2;
  const grad = wctx.createLinearGradient(0, 0, waveW, 0);
  grad.addColorStop(0, 'rgba(238,216,169,0.2)');
  grad.addColorStop(0.5, 'rgba(238,216,169,0.95)');
  grad.addColorStop(1, 'rgba(238,216,169,0.2)');
  wctx.lineWidth = 2.1;
  wctx.strokeStyle = grad;
  wctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * waveW;
    const v = (data[i] - 128) / 128;
    const y = mid + v * waveH * 0.42;
    if (i === 0) wctx.moveTo(x, y); else wctx.lineTo(x, y);
  }
  wctx.stroke();
}

/* 星空 */
const starCanvas = $('#starCanvas');
const sctx = starCanvas.getContext('2d');
let stars = [], starW = 0, starH = 0;

function buildStars() {
  const count = Math.min(130, Math.floor((starW * starH) / 11000));
  stars = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random() * starW,
      y: Math.random() * starH,
      r: Math.random() * 1.3 + 0.3,
      base: Math.random() * 0.5 + 0.22,
      speed: Math.random() * 0.9 + 0.25,
      phase: Math.random() * Math.PI * 2
    });
  }
}
function fitStar() {
  const dpr = window.devicePixelRatio || 1;
  starW = window.innerWidth; starH = window.innerHeight;
  starCanvas.width = Math.max(1, Math.round(starW * dpr));
  starCanvas.height = Math.max(1, Math.round(starH * dpr));
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  buildStars();
}
function drawStars(t) {
  sctx.clearRect(0, 0, starW, starH);
  for (const s of stars) {
    const tw = 0.5 + 0.5 * Math.sin(t * 0.001 * s.speed + s.phase);
    const a = s.base * (0.3 + 0.7 * tw);
    sctx.globalAlpha = a;
    sctx.fillStyle = '#f4e9cd';
    sctx.beginPath();
    sctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    sctx.fill();
    if (s.r > 1.2 && tw > 0.72) {
      sctx.globalAlpha = a * 0.45;
      sctx.strokeStyle = '#f4e9cd';
      sctx.lineWidth = 0.7;
      sctx.beginPath();
      sctx.moveTo(s.x - s.r * 2.6, s.y); sctx.lineTo(s.x + s.r * 2.6, s.y);
      sctx.moveTo(s.x, s.y - s.r * 2.6); sctx.lineTo(s.x, s.y + s.r * 2.6);
      sctx.stroke();
    }
  }
  sctx.globalAlpha = 1;
}

function frameLoop(t) {
  if (waveW === 0 || waveH === 0) fitWave();
  if (starW === 0 || starH === 0) fitStar();
  waveT += 0.02;
  if (rec.mode === 'recording' && rec.analyser) drawLiveWave(); else drawIdleWave();
  drawStars(t);
  requestAnimationFrame(frameLoop);
}
function fitAll() { fitWave(); fitStar(); }
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(fitAll, 200); });
fitAll();
requestAnimationFrame(frameLoop);
