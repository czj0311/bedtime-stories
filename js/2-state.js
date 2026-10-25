/* ===== 全局状态 ===== */
const state = {
  stories: [],        // 全部故事（最新在前）
  filter: 'all',      // all | fav
  search: '',
  pending: null,      // 待保存的录音 {blob,mime,duration,url}
  currentId: null,    // 当前播放的故事 id
  shuffle: false
};

const rec = {
  mr: null,           // MediaRecorder
  chunks: [],
  stream: null,
  mime: '',
  mode: 'idle',       // idle | recording | paused
  seconds: 0,
  tick: null,         // 计时 interval
  startedAt: 0,
  accumMs: 0,
  audioCtx: null,
  analyser: null
};
