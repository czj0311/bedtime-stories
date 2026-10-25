/* ===== 白噪音（Web Audio 纯合成，无需音频文件） ===== */
const ambient = {
  ctx: null, src: null, envGain: null, volGain: null,
  lfo: null, kind: null, playing: false
};

function ambientVol() {
  const v = $('#ambVolume');
  return v ? Number(v.value) / 100 : 0.5;
}

// 生成循环噪声 buffer：white / brown
function makeNoiseBuffer(ctx, color) {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (color === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.4;
    } else {
      d[i] = w;
    }
  }
  return buf;
}

function updateAmbientUI() {
  $$('.amb-btn').forEach(btn => {
    btn.classList.toggle('is-on', ambient.playing && btn.dataset.kind === ambient.kind);
  });
}

async function startAmbient(kind) {
  // 再次点当前项 = 关闭
  if (ambient.playing && ambient.kind === kind) { stopAmbient(); return; }
  try {
    if (!ambient.ctx) ambient.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = ambient.ctx;
    await ctx.resume();
    stopAmbient(true);

    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const envGain = ctx.createGain();
    const volGain = ctx.createGain();

    let color = 'white', base = 0.4, lfoFreq = 0, lfoDepth = 0;
    if (kind === 'rain') {
      color = 'white'; base = 0.34;
      filter.type = 'bandpass'; filter.frequency.value = 2600; filter.Q.value = 0.4;
    } else if (kind === 'wave') {
      color = 'brown'; base = 0.5;
      filter.type = 'lowpass'; filter.frequency.value = 480;
      lfoFreq = 0.11; lfoDepth = 0.28;
    } else { // wind
      color = 'brown'; base = 0.42;
      filter.type = 'bandpass'; filter.frequency.value = 420; filter.Q.value = 0.7;
      lfoFreq = 0.07; lfoDepth = 0.26;
    }

    src.buffer = makeNoiseBuffer(ctx, color);
    src.loop = true;
    src.connect(filter); filter.connect(envGain); envGain.connect(volGain); volGain.connect(ctx.destination);

    envGain.gain.value = base;
    volGain.gain.value = 0;
    volGain.gain.linearRampToValueAtTime(ambientVol(), ctx.currentTime + 1.2);

    let lfo = null;
    if (lfoFreq > 0) {
      lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = lfoFreq;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = lfoDepth;
      lfo.connect(lfoGain); lfoGain.connect(envGain.gain);
      lfo.start();
    }
    src.start();
    Object.assign(ambient, { src, envGain, volGain, lfo, kind, playing: true });
    updateAmbientUI();
  } catch (e) {
    toast('白噪音无法开启');
  }
}

function stopAmbient(immediate) {
  if (!ambient.ctx || !ambient.playing) return;
  const ctx = ambient.ctx;
  const { src, volGain, lfo } = ambient;
  if (volGain) {
    try {
      volGain.gain.cancelScheduledValues(ctx.currentTime);
      volGain.gain.setValueAtTime(volGain.gain.value, ctx.currentTime);
      volGain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + (immediate ? 0.05 : 0.6));
    } catch (e) {}
  }
  setTimeout(() => { try { src && src.stop(); } catch (e) {} try { lfo && lfo.stop(); } catch (e) {} }, immediate ? 80 : 650);
  ambient.playing = false; ambient.kind = null;
  updateAmbientUI();
}

function setAmbientVolume(v) {
  if (ambient.volGain && ambient.ctx) {
    ambient.volGain.gain.setTargetAtTime(v, ambient.ctx.currentTime, 0.1);
  }
}
