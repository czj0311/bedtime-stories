/* ===== 录音 ===== */
const ICON_PAUSE = '<svg viewBox="0 0 24 24" class="ic"><path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 24 24" class="ic"><path d="M8 5.5v13a1 1 0 0 0 1.54.84l10-6.5a1 1 0 0 0 0-1.68l-10-6.5A1 1 0 0 0 8 5.5z" fill="currentColor"/></svg>';

const REC_MP3_SAMPLE_RATE = 44100;

function extFor(mime) {
  if (/mpeg|mp3/i.test(mime)) return 'mp3';
  if (/mp4|m4a/i.test(mime)) return 'm4a';
  if (/ogg/i.test(mime)) return 'ogg';
  return 'webm';
}

function floatTo16BitPcm(input) {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

// 跨回调保留插值位置，避免每个 ScriptProcessor 数据块边缘产生断点。
function resampleForMp3(input, session) {
  if (session.inputRate === session.targetRate || !input.length) return input;
  const ratio = session.inputRate / session.targetRate;
  const output = new Float32Array(Math.ceil(input.length / ratio) + 2);
  let position = session.resamplePos;
  let count = 0;
  while (position < input.length - 1) {
    const index = Math.floor(position);
    const fraction = position - index;
    const previous = index < 0 ? session.resamplePrev : input[index];
    const next = input[index + 1];
    output[count++] = previous + (next - previous) * fraction;
    position += ratio;
  }
  session.resamplePrev = input[input.length - 1];
  session.resamplePos = position - input.length;
  return output.subarray(0, count);
}

function appendMp3Data(session, data) {
  if (!data || !data.length) return;
  const chunk = new Uint8Array(data.length);
  chunk.set(data);
  session.chunks.push(chunk);
}

function encodePcmBlock(session, input) {
  const resampled = resampleForMp3(input, session);
  if (!resampled.length) return;
  appendMp3Data(session, session.encoder.encodeBuffer(floatTo16BitPcm(resampled)));
}

function cleanupRecSession(session) {
  if (!session || session.cleaned) return;
  session.cleaned = true;
  session.ending = true;
  if (session.processor) session.processor.onaudioprocess = null;
  [session.source, session.analyser, session.processor, session.mute].forEach(node => {
    if (node) { try { node.disconnect(); } catch (e) {} }
  });
  if (session.stream) {
    session.stream.getTracks().forEach(track => { try { track.stop(); } catch (e) {} });
  }
  if (session.audioCtx && typeof session.audioCtx.close === 'function') {
    try {
      const closing = session.audioCtx.close();
      if (closing && closing.catch) closing.catch(() => {});
    } catch (e) {}
  }
  if (rec.session === session) {
    rec.session = null;
    rec.stream = null;
    rec.audioCtx = null;
    rec.analyser = null;
    rec.encoder = null;
    rec.source = null;
    rec.processor = null;
    rec.mute = null;
    rec.chunks = [];
    rec.mr = null;
    rec.discard = false;
  }
}

function recTickFn() {
  rec.seconds = Math.floor((rec.accumMs + (performance.now() - rec.startedAt)) / 1000);
  const el = $('#recTime');
  if (el) el.textContent = fmtClock(rec.seconds);
}

async function startRecording() {
  if (rec.mode === 'recording' || rec.mode === 'paused') { stopRecording(false); return; }
  if (rec.starting) return;
  if (typeof Mp3Encoder !== 'function') {
    toast('MP3 编码器未加载，无法录音');
    return;
  }

  rec.starting = true;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
  } catch (e) {
    rec.starting = false;
    toast('无法访问麦克风，请在设置里允许录音');
    return;
  }

  const session = {
    stream,
    audioCtx: null,
    source: null,
    analyser: null,
    processor: null,
    mute: null,
    encoder: null,
    chunks: [],
    inputRate: REC_MP3_SAMPLE_RATE,
    targetRate: REC_MP3_SAMPLE_RATE,
    resamplePrev: 0,
    resamplePos: 0,
    ending: false,
    cleaned: false,
    failureMessage: ''
  };
  rec.session = session;
  rec.stream = stream;
  rec.chunks = session.chunks;

  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) throw new Error('AudioContext unavailable');
    let actx;
    try { actx = new AudioCtx({ sampleRate: REC_MP3_SAMPLE_RATE }); }
    catch (e) { actx = new AudioCtx(); }
    session.audioCtx = actx;
    session.inputRate = actx.sampleRate;
    session.encoder = new Mp3Encoder(1, REC_MP3_SAMPLE_RATE, 64);

    const src = actx.createMediaStreamSource(stream);
    const analyser = actx.createAnalyser();
    const processor = actx.createScriptProcessor(4096, 1, 1);
    const mute = actx.createGain();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.7;
    mute.gain.value = 0;
    session.source = src;
    session.analyser = analyser;
    session.processor = processor;
    session.mute = mute;

    processor.onaudioprocess = event => {
      if (rec.session !== session || rec.mode !== 'recording' || session.ending) return;
      try {
        encodePcmBlock(session, event.inputBuffer.getChannelData(0));
      } catch (e) {
        session.failureMessage = 'MP3 编码失败，录音已丢弃';
        stopRecording(true);
      }
    };
    src.connect(analyser);
    src.connect(processor);
    processor.connect(mute);
    mute.connect(actx.destination);

    rec.audioCtx = actx;
    rec.analyser = analyser;
    rec.encoder = session.encoder;
    rec.source = src;
    rec.processor = processor;
    rec.mute = mute;
    if (typeof actx.resume === 'function') await actx.resume();
    if (rec.session !== session || session.cleaned) return;

    rec.mime = 'audio/mpeg';
    rec.mode = 'recording';
    rec.startedAt = performance.now();
    rec.accumMs = 0;
    rec.seconds = 0;
    rec.discard = false;
    clearInterval(rec.tick);
    rec.tick = setInterval(recTickFn, 250);
    updateRecUI();
  } catch (e) {
    cleanupRecSession(session);
    rec.mode = 'idle';
    updateRecUI();
    toast('录音启动失败');
  } finally {
    rec.starting = false;
  }
}

function pauseRecording() {
  if (rec.mode !== 'recording' || !rec.session) return;
  rec.accumMs += performance.now() - rec.startedAt;
  rec.seconds = Math.floor(rec.accumMs / 1000);
  rec.mode = 'paused';
  clearInterval(rec.tick);
  rec.tick = null;
  updateRecUI();
}
function resumeRecording() {
  if (rec.mode !== 'paused' || !rec.session) return;
  const session = rec.session;
  const actx = session.audioCtx;
  let resuming = null;
  try {
    if (actx && actx.state !== 'running' && typeof actx.resume === 'function') {
      resuming = actx.resume();
    }
  } catch (e) {
    session.failureMessage = '无法继续录音，录音已丢弃';
    stopRecording(true);
    return;
  }
  rec.startedAt = performance.now();
  rec.mode = 'recording';
  clearInterval(rec.tick);
  rec.tick = setInterval(recTickFn, 250);
  updateRecUI();
  if (resuming && typeof resuming.catch === 'function') {
    resuming.catch(() => {
      if (rec.session === session && rec.mode === 'recording') {
        session.failureMessage = '无法继续录音，录音已丢弃';
        stopRecording(true);
      }
    });
  }
}

function stopRecording(discard) {
  const session = rec.session;
  if (!session || rec.mode === 'idle') return;
  clearInterval(rec.tick);
  rec.tick = null;
  rec.discard = !!discard;
  session.ending = true;
  if (rec.mode === 'recording') rec.accumMs += performance.now() - rec.startedAt;
  rec.seconds = Math.max(0, Math.floor(rec.accumMs / 1000));
  rec.mode = 'idle';
  onRecordingStopped(session, !!discard);
  updateRecUI();
}

function onRecordingStopped(session, discard) {
  if (!session || session.finalized) return;
  session.finalized = true;
  const duration = rec.seconds;
  let blob = null;
  if (!discard && !session.failureMessage) {
    try {
      appendMp3Data(session, session.encoder.flush());
      blob = new Blob(session.chunks, { type: 'audio/mpeg' });
    } catch (e) {
      session.failureMessage = 'MP3 编码失败，录音已丢弃';
    }
  }
  cleanupRecSession(session);
  if (discard || session.failureMessage) {
    toast(session.failureMessage || '已丢弃这段录音');
    return;
  }
  if (duration < 1 || !blob || blob.size < 500) {
    toast('录音太短，已丢弃');
    return;
  }
  const url = URL.createObjectURL(blob);
  state.pending = { blob, mime: 'audio/mpeg', duration, url };
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
  const mic = recBtn.querySelector('.ic-mic'), stop = recBtn.querySelector('.ic-stop');
  if (mic) mic.hidden = (mode !== 'idle');
  if (stop) stop.hidden = (mode === 'idle');
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
