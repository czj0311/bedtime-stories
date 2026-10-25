/* ===== 自定义定时 + 休眠 ===== */
let timerRemain = 0;
let timerInterval = null;

function isSoundOn() {
  return (!audio.paused && !audio.ended && audio.currentTime > 0) || ambient.playing;
}

function setTimerBtn() {
  const btn = $('#timerBtn'), label = $('#timerLabel');
  if (timerRemain > 0) {
    const m = Math.floor(timerRemain / 60), s = timerRemain % 60;
    label.textContent = m > 0 ? `${m}:${pad(s)}` : `${s} 秒`;
    btn.classList.add('is-on');
  } else {
    label.textContent = '定时';
    btn.classList.remove('is-on');
  }
}

function armTimer(mins) {
  mins = Math.min(600, Math.max(1, Math.round(Number(mins) || 0)));
  clearInterval(timerInterval);
  timerRemain = mins * 60;
  setTimerBtn();
  timerInterval = setInterval(() => {
    timerRemain--;
    setTimerBtn();
    if (timerRemain <= 0) {
      clearInterval(timerInterval);
      timerRemain = 0;
      enterSleep();
    }
  }, 1000);
}

function cancelTimer() {
  clearInterval(timerInterval);
  timerRemain = 0;
  setTimerBtn();
}

function enterSleep() {
  setTimerBtn();
  // 录音中不强制休眠，避免丢失正在录的内容
  if (rec.mode !== 'idle') { cancelTimer(); return; }
  try { if (!audio.paused) audio.pause(); } catch (e) {}
  if (ambient.playing) stopAmbient();
  const veil = $('#sleepVeil');
  veil.hidden = false;
  // 全屏独立窗口时可尝试关闭，普通网页无效（已容错）
  setTimeout(() => { try { window.close(); } catch (e) {} }, 400);
}

function wakeSleep() {
  $('#sleepVeil').hidden = true;
}
