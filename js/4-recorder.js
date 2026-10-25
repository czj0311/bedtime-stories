/* ===== 录音 ===== */
const ICON_PAUSE = '<svg viewBox="0 0 24 24" class="ic"><path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 24 24" class="ic"><path d="M8 5.5v13a1 1 0 0 0 1.54.84l10-6.5a1 1 0 0 0 0-1.68l-10-6.5A1 1 0 0 0 8 5.5z" fill="currentColor"/></svg>';

function pickMime() {
  const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
  if (window.MediaRecorder && MediaRecorder.isTypeSupported) {
    for (const c of cands) { try { if (MediaRecorder.isTypeSupported(c)) return c; } catch (e) {} }
  }
  return '';
}
function extFor(mime) {
  if (/mp4|m4a/i.test(mime)) return 'm4a';
  if (/ogg/i.test(mime)) return 'ogg';
  return 'webm';
}

function recTickFn() {
  rec.seconds = Math.floor((rec.accumMs + (performance.now() - rec.startedAt)) / 1000);
  const el = $('#recTime');
  if (el) el.textContent = fmtClock(rec.seconds);
}

async function startRecording() {
  if (rec.mode === 'recording' || rec.mode === 'paused') { stopRecording(false); return; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
  } catch (e) {
    toast('无法访问麦克风，请在设置里允许录音');
    return;
  }
  rec.stream = stream;
  rec.mime = pickMime();
  let mr;
  try {
    mr = new MediaRecorder(stream, rec.mime ? { mimeType: rec.mime } : undefined);
  } catch (e) {
    mr = new MediaRecorder(stream);
    rec.mime = mr.mimeType || 'audio/webm';
  }
  rec.mr = mr; rec.chunks = [];
  mr.ondataavailable = e => { if (e.data && e.data.size) rec.chunks.push(e.data); };
  mr.onstop = () => onRecordingStopped();

  try {
    const actx = new (window.AudioContext || window.webkitAudioContext)();
    const src = actx.createMediaStreamSource(stream);
    const analyser = actx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.7;
    src.connect(analyser);
    rec.audioCtx = actx; rec.analyser = analyser;
  } catch (e) { rec.analyser = null; }

  try { mr.start(); } catch (e) { toast('录音启动失败'); return; }
  rec.mode = 'recording';
  rec.startedAt = performance.now(); rec.accumMs = 0; rec.seconds = 0;
  clearInterval(rec.tick);
  rec.tick = setInterval(recTickFn, 250);
  updateRecUI();
}

function pauseRecording() {
  if (rec.mode !== 'recording' || !rec.mr) return;
  rec.mr.pause();
  rec.accumMs += performance.now() - rec.startedAt;
  rec.mode = 'paused';
  clearInterval(rec.tick);
  updateRecUI();
}
function resumeRecording() {
  if (rec.mode !== 'paused' || !rec.mr) return;
  rec.mr.resume();
  rec.startedAt = performance.now();
  rec.mode = 'recording';
  clearInterval(rec.tick);
  rec.tick = setInterval(recTickFn, 250);
  updateRecUI();
}

function stopRecording(discard) {
  if (!rec.mr || rec.mode === 'idle') return;
  clearInterval(rec.tick);
  rec.discard = !!discard;
  if (rec.mode === 'recording') rec.accumMs += performance.now() - rec.startedAt;
  rec.seconds = Math.max(0, Math.floor(rec.accumMs / 1000));
  try { rec.mr.stop(); } catch (e) {}
  if (rec.stream) rec.stream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} });
  rec.mode = 'idle';
  updateRecUI();
}

function onRecordingStopped() {
  const blob = new Blob(rec.chunks, { type: rec.mime || 'audio/webm' });
  const duration = rec.seconds;
  if (rec.audioCtx) { try { rec.audioCtx.close(); } catch (e) {} }
  rec.audioCtx = null; rec.analyser = null; rec.chunks = [];
  const discard = rec.discard; rec.discard = false;
  if (discard) { toast('已丢弃这段录音'); return; }
  if (duration < 1 || blob.size < 500) { toast('录音太短，已丢弃'); return; }
  const url = URL.createObjectURL(blob);
  state.pending = { blob, mime: rec.mime || 'audio/webm', duration, url };
  openSaveModal(duration);
}

function updateRecUI() {
  const mode = rec.mode;
  const recBtn = $('#recBtn'), pauseBtn = $('#pauseBtn'), discardBtn = $('#discardBtn');
  const wrap = $('.rec-status'), status = $('#recStatus'), hint = $('#recHint');
  if (!recBtn) return;
  wrap.classList.toggle('recording', mode === 'recording');
  wrap.classList.toggle('paused', mode === 'paused');
  recBtn.classList.toggle('is-recording', mode !== 'idle');
  discardBtn.disabled = (mode === 'idle');
  if (mode === 'recording') {
    status.textContent = '正在录音';
    pauseBtn.disabled = false; pauseBtn.innerHTML = ICON_PAUSE;
    hint.textContent = '再点金色按钮结束，可随时暂停';
  } else if (mode === 'paused') {
    status.textContent = '已暂停';
    pauseBtn.disabled = false; pauseBtn.innerHTML = ICON_PLAY;
    hint.textContent = '已暂停，点播放继续，再点金色结束';
  } else {
    status.textContent = '准备就绪';
    $('#recTime').textContent = fmtClock(rec.seconds || 0);
    pauseBtn.disabled = true; pauseBtn.innerHTML = ICON_PAUSE;
    hint.textContent = '轻点金色按钮开始录音，再点一次结束';
  }
}
