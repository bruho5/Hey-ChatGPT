'use strict';
const byId = id => document.getElementById(id);
const strings = {
  zh: {
    eyebrow: 'WINDOWS · 语音助手', language: '语言', subtitle: '用口令唤醒你保存的 ChatGPT 会话。',
    statusLabel: '助手状态', folderLabel: '原唤醒助手的文件夹', browse: '浏览',
    folderPlaceholder: '选择含 .venv、probe.py 和 model 的文件夹',
    hint: '不会修改这个文件夹。Chrome 里的扩展负责会话和口令设置；设置好以后可以关闭扩展页。',
    foot: '关闭此窗会隐藏到托盘。可在托盘暂停监听或完全退出。',
    waiting: '等待 Chrome 扩展连接…', running: '监听中', busy: '处理中', paused: '已暂停',
    pause: '暂停监听', start: '开始监听', unreadable: '无法读取本机状态。',
  },
  en: {
    eyebrow: 'WINDOWS · VOICE ASSISTANT', language: 'Language', subtitle: 'Open a saved ChatGPT conversation with a wake phrase.',
    statusLabel: 'Helper status', folderLabel: 'Wake-word helper folder', browse: 'Browse',
    folderPlaceholder: 'Choose the folder containing .venv, probe.py and model',
    hint: 'This folder is not changed. Set your chats and phrases in the Chrome extension; you can close its settings tab afterward.',
    foot: 'Closing this window hides it in the tray. Pause listening or quit from the tray menu.',
    waiting: 'Waiting for the Chrome extension…', running: 'Listening', busy: 'Working', paused: 'Paused',
    pause: 'Pause listening', start: 'Start listening', unreadable: 'Could not read local status.',
  },
};
let acting = false, status = null, language = 'zh', actionEpoch = 0;
const call = (name, ...args) => window.mygo.call('Desktop.' + name, ...args);
function translate(nextLanguage) {
  language = nextLanguage === 'en' ? 'en' : 'zh';
  const text = strings[language];
  document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  byId('language').value = language;
  for (const el of document.querySelectorAll('[data-label]')) el.textContent = text[el.dataset.label];
  byId('status-region').setAttribute('aria-label', text.statusLabel);
  byId('folder').placeholder = text.folderPlaceholder;
}
function paint(next) {
  status = next;
  if (next.language !== language) translate(next.language);
  const text = strings[language];
  byId('folder').value = next.folder;
  byId('status').textContent = next.message;
  byId('chrome').textContent = next.chrome || (next.running ? text.waiting : '');
  byId('badge').textContent = next.running ? text.running : next.busy ? text.busy : text.paused;
  byId('badge').classList.toggle('running', next.running);
  byId('listen').textContent = next.running || next.busy ? text.pause : text.start;
  byId('listen').disabled = acting || !next.ready || !next.folder;
  byId('choose').disabled = acting || next.running || next.busy;
  byId('language').disabled = acting;
}
function showError(e) {
  const line = byId('error');
  line.textContent = e instanceof Error ? e.message : String(e);
  line.hidden = false;
}
async function invoke(name, ...args) {
  if (acting) return;
  acting = true;
  actionEpoch++;
  byId('error').hidden = true;
  if (status) paint(status);
  try {
    paint(await call(name, ...args));
  } catch (e) {
    showError(e);
  } finally {
    acting = false;
    if (status) paint(status);
  }
}
byId('language').onchange = ({target}) => void invoke('SetLanguage', target.value);
byId('choose').onclick = () => void invoke('ChooseFolder');
byId('listen').onclick = () => void invoke(status?.running || status?.busy ? 'PauseListening' : 'StartListening');
let reading = false;
async function refresh() {
  if (acting || reading || document.hidden) return;
  reading = true;
  const epoch = actionEpoch;
  try {
    const next = await call('Status');
    if (!acting && epoch === actionEpoch) paint(next);
  } catch {
    if (!acting && epoch === actionEpoch) byId('status').textContent = strings[language].unreadable;
  } finally {
    reading = false;
  }
}
document.addEventListener('visibilitychange', refresh);
setInterval(refresh, 700);
translate(language);
void refresh();
