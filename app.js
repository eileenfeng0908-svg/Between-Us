// ==============================================
//  Between Us — app.js
// ==============================================

// ---- DOM references --------------------------------------------------

const $ = id => document.getElementById(id);

const sections = {
  name:           $('nameSection'),
  compose:        $('composeSection'),
  sending:        $('sendingSection'),
  reply:          $('replySection'),
  archive:        $('archiveSection'),
  correspondence: $('correspondenceSection'),
};

const nameInput       = $('nameInput');
const nameBtn         = $('nameBtn');
const homeBtn         = $('homeBtn');

const recipientInput  = $('recipientInput');
const letterBody      = $('letterBody');
const voiceRef        = $('voiceRef');
const replyLanguage   = $('replyLanguage');
const sendBtn         = $('sendBtn');

const animLetter      = $('animLetter');
const animEnvelope    = $('animEnvelope');
const sendingCaption  = $('sendingCaption');
const sendingEnvelopeTo = $('sendingEnvelopeTo');
const sendingEnvelopeFrom = $('sendingEnvelopeFrom');

const threadContainer = $('threadContainer');
const typingSkip      = $('typingSkip');
const skipTypingBtn   = $('skipTypingBtn');
const readAloudBtn    = $('readAloudBtn');
const currentReadControls = $('currentReadControls');

const writeBackCompose  = $('writeBackCompose');
const writeBackTo       = $('writeBackTo');
const writeBackBody     = $('writeBackBody');
const writeBackSendBtn  = $('writeBackSendBtn');
const writeBackBtn      = $('writeBackBtn');
const writeAnotherBtn   = $('writeAnotherBtn');
const archiveToggle   = $('archiveToggle');
const archiveClose    = $('archiveClose');
const archiveList     = $('archiveList');
const archiveEmpty    = $('archiveEmpty');
const archiveStatus   = $('archiveStatus');

const corrBack        = $('corrBack');
const corrExchange    = $('corrExchange');

// ---- Persistence keys ------------------------------------------------
// Username: sessionStorage so it doesn't persist on shared devices.
// Language: localStorage — it's a UI preference, not personal content.
// Letters: not stored on this device. See db.js.

const USER_KEY     = 'betweenus_username';
const LANGUAGE_KEY = 'betweenus_reply_language';

let currentReplyText = '';
let replyTypingTimer = null;
let replyTypingRun = 0;
let activeReplyBody = '';
let activeTypingBodyEl = null;
let activeTypingSigEl = null;
let isReplyTyping = false;
let activeReading = null;
let currentReading = null;
let sendAbortController = null;
let sendAnimationTimers = [];
let sendRun = 0;
let correspondenceOpenTimers = [];
let correspondenceOpenRun = 0;
let conversationThread = [];
let currentConversation = { to: '', userName: '', language: '', voiceRef: '' };

// ---- Username --------------------------------------------------------

function getUserName() {
  return sessionStorage.getItem(USER_KEY) || '';
}

function setUserName(name) {
  sessionStorage.setItem(USER_KEY, name.trim());
}

// ---- Navigation ------------------------------------------------------

function showSection(name, scrollBehavior = 'auto') {
  Object.entries(sections).forEach(([key, el]) => {
    el.classList.toggle('hidden', key !== name);
  });
  window.scrollTo({ top: 0, behavior: scrollBehavior });
}

// ---- Init ------------------------------------------------------------

function init() {
  // Clear any letter data left by older versions of this app
  try {
    localStorage.removeItem('letterback_v2');
    localStorage.removeItem('letterback_username');
  } catch {}

  currentReading = createReadingController(
    currentReadControls,
    () => currentReplyText,
  );
  replyLanguage.value = localStorage.getItem(LANGUAGE_KEY) || 'auto';

  if (!getUserName()) {
    showSection('name');
    setTimeout(() => nameInput.focus(), 50);
  } else {
    showSection('compose');
  }
}

// ---- Name section ----------------------------------------------------

function handleNameSubmit() {
  const name = nameInput.value.trim();
  if (!name) { nameInput.focus(); return; }
  setUserName(name);
  showSection('compose');
  recipientInput.focus();
}

nameBtn.addEventListener('click', handleNameSubmit);
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleNameSubmit(); });

// ---- Event listeners -------------------------------------------------

sendBtn.addEventListener('click', handleSend);
homeBtn.addEventListener('click', resetToFreshDesk);
replyLanguage.addEventListener('change', () => {
  localStorage.setItem(LANGUAGE_KEY, replyLanguage.value);
});
skipTypingBtn.addEventListener('click', skipReplyTyping);
document.addEventListener('keydown', handleTypingShortcut);

writeAnotherBtn.addEventListener('click', resetToFreshDesk);
writeBackBtn.addEventListener('click', handleWriteBack);
writeBackSendBtn.addEventListener('click', handleWriteBackSend);

archiveToggle.addEventListener('click', () => {
  cancelCorrespondenceOpening();
  renderArchive();
  showSection('archive');
});

archiveClose.addEventListener('click', () => {
  cancelCorrespondenceOpening();
  showSection('compose');
});

corrBack.addEventListener('click', () => {
  if (activeReading) stopReading(activeReading, true);
  cancelCorrespondenceOpening();
  renderArchive();
  showSection('archive');
});

function resetToFreshDesk() {
  cancelPendingSend();
  cancelCorrespondenceOpening();

  stopReplyTyping();
  if (activeReading) stopReading(activeReading, true);
  resetReading();
  resetAnimations();

  recipientInput.value = '';
  letterBody.value = '';
  voiceRef.value = '';
  voiceRef.closest('details')?.removeAttribute('open');

  // Clear conversation thread
  threadContainer.innerHTML = '';
  conversationThread = [];
  currentConversation = { to: '', userName: '', language: '', voiceRef: '' };
  writeBackCompose.classList.add('hidden');
  writeBackCompose.classList.remove('entering');
  writeBackBtn.classList.add('hidden');
  writeBackBody.value = '';

  // Restore entry animation for the next first-show
  sections.reply.classList.remove('no-entry-anim');

  typingSkip.classList.add('hidden');
  corrExchange.innerHTML = '';

  showSection('compose', 'smooth');
  setTimeout(() => recipientInput.focus({ preventScroll: true }), 320);
}

// ---- Send flow -------------------------------------------------------

function handleSend() {
  const to       = recipientInput.value.trim() || 'Someone';
  const text     = letterBody.value.trim();
  const voice    = voiceRef.value.trim();
  const language = replyLanguage.value;
  const userName = getUserName();

  if (!text) { letterBody.focus(); return; }

  sendingEnvelopeTo.textContent = to;
  sendingEnvelopeFrom.textContent = `from ${userName}`;

  cancelPendingSend();
  const run = ++sendRun;
  sendAbortController = new AbortController();

  // Start API call immediately so it runs in parallel with the animation
  const replyPromise = fetchReply({
    to,
    userName,
    text,
    voiceRef: voice,
    language,
    history: [],
    signal: sendAbortController.signal,
  }).catch(() => null);

  // Reset thread for a fresh conversation
  conversationThread = [];
  threadContainer.innerHTML = '';
  sections.reply.classList.remove('no-entry-anim');

  showSection('sending');
  resetAnimations();

  runSendAnimation(async () => {
    if (run !== sendRun) return;

    const apiData = await replyPromise;
    if (run !== sendRun) return;

    const date = new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });

    let reply;
    if (apiData && apiData.body) {
      reply = {
        date,
        to,
        userName,
        salutation: apiData.salutation || defaultSalutation(userName, language),
        body:       apiData.body,
        signature:  apiData.signature || defaultSignature(to, language),
      };
    } else {
      reply = generateReply({ to, userName, text, voiceRef: voice, language });
    }

    const preview = extractPreview(reply.body);
    await saveToArchive({
      date:            reply.date,
      to,
      userName:        reply.userName || userName,
      original:        text,
      preview,
      replyBody:       reply.body,
      replySignature:  reply.signature,
      replySalutation: reply.salutation,
      language,
    });

    // Track conversation state
    currentConversation = { to, userName, language, voiceRef: voice };
    conversationThread = [
      { role: 'user', text },
      { role: 'assistant', text: reply.body },
    ];

    // Fade out "Delivered.", then bridge to "A letter has returned."
    sendingCaption.style.opacity = '0';
    await new Promise(resolve => {
      sendAnimationTimers.push(setTimeout(resolve, 550));
    });
    if (run !== sendRun) return;

    sendingCaption.textContent = 'A letter has returned.';
    sendingCaption.style.opacity = '1';

    await new Promise(resolve => {
      sendAnimationTimers.push(setTimeout(resolve, 1600));
    });
    if (run !== sendRun) return;

    // Append exchange to thread, start typing timer
    const sentData = { to, userName, body: text, date: reply.date };
    displayReply(sentData, reply);

    showSection('reply');
    writeBackBtn.classList.remove('hidden');
    sendAbortController = null;
  });
}

async function fetchReply({ to, userName, text, voiceRef, language, history = [], signal }) {
  const res = await fetch('/reply', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body:    JSON.stringify({ to, userName, text, voiceRef, language, history }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---- Animation sequence ----------------------------------------------

function resetAnimations() {
  animLetter.classList.remove('departing', 'folding');
  animLetter.classList.remove('hidden');
  animEnvelope.classList.remove('appearing', 'departing');
  animEnvelope.classList.add('hidden');
  sendingCaption.textContent = '';
  sendingCaption.style.opacity = '0';
  void animLetter.offsetWidth;
}

function runSendAnimation(onComplete) {
  sendAnimationTimers.push(setTimeout(() => {
    sendingCaption.textContent = 'Folding your letter…';
    sendingCaption.style.opacity = '1';
  }, 300));

  sendAnimationTimers.push(setTimeout(() => {
    animLetter.classList.add('folding');
  }, 900));

  sendAnimationTimers.push(setTimeout(() => {
    animLetter.classList.add('hidden');
    animEnvelope.classList.remove('hidden');
    void animEnvelope.offsetWidth;
    animEnvelope.classList.add('appearing');
    sendingCaption.style.opacity = '0';
  }, 1600));

  sendAnimationTimers.push(setTimeout(() => {
    sendingCaption.textContent = 'Sending your letter…';
    sendingCaption.style.opacity = '1';
  }, 2000));

  sendAnimationTimers.push(setTimeout(() => {
    animEnvelope.classList.remove('appearing');
    void animEnvelope.offsetWidth;
    animEnvelope.classList.add('departing');
    sendingCaption.style.opacity = '0';
  }, 2900));

  sendAnimationTimers.push(setTimeout(() => {
    sendingCaption.textContent = 'Delivered.';
    sendingCaption.style.opacity = '1';
  }, 3300));

  sendAnimationTimers.push(setTimeout(onComplete, 3600));
}

function cancelPendingSend() {
  sendRun += 1;

  if (sendAbortController) {
    sendAbortController.abort();
    sendAbortController = null;
  }

  sendAnimationTimers.forEach(clearTimeout);
  sendAnimationTimers = [];
}

// ---- Reply display ---------------------------------------------------

function displayReply(sentData, reply) {
  stopReplyTyping();
  const replyLang = containsChinese(reply.body) ? 'zh-CN' : 'en';
  activeReplyBody = reply.body;
  currentReplyText = `${reply.salutation}\n\n${reply.body}\n\n${reply.signature}`;
  resetReading(false);
  readAloudBtn.disabled = true;

  const { bodyEl, sigEl } = appendExchange(sentData, reply, replyLang);
  activeTypingBodyEl = bodyEl;
  activeTypingSigEl  = sigEl;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    finishReplyTyping(reply.body);
    return;
  }

  const run = ++replyTypingRun;
  isReplyTyping = true;
  bodyEl.classList.add('is-typing');
  typingSkip.classList.remove('hidden', 'is-leaving');
  replyTypingTimer = setTimeout(() => typeReplyBody(reply.body, run), 520);
}

function appendExchange(sentData, reply, replyLang) {
  const exchange = document.createElement('div');
  exchange.className = 'thread-exchange';

  // Sent card (user's letter)
  const sentCard = document.createElement('div');
  sentCard.className = 'stationery sent-letter';
  sentCard.innerHTML = `
    <div class="sent-letter-header">
      <span class="sent-letter-to">To: ${esc(sentData.to)}</span>
      <span class="sent-letter-date">${esc(sentData.date)}</span>
    </div>
    <div class="sent-letter-body">${esc(sentData.body)}</div>
  `;
  exchange.appendChild(sentCard);

  // Separator
  const sep = document.createElement('div');
  sep.className = 'thread-sep';
  sep.innerHTML = '<span class="thread-sep-dot"></span>';
  exchange.appendChild(sep);

  // Reply card
  const replyCard = document.createElement('div');
  replyCard.className = 'stationery reply-paper';
  replyCard.innerHTML = `
    <div class="reply-header">
      <div class="reply-address-block">
        <span>To: ${esc(reply.userName)}</span>
        <span>From: ${esc(reply.to)}</span>
      </div>
      <div class="reply-date-line">${esc(reply.date)}</div>
    </div>
    <div class="reply-salutation" lang="${replyLang}">${esc(reply.salutation)}</div>
    <div class="reply-body" lang="${replyLang}"></div>
    <div class="reply-sig awaiting-signature" lang="${replyLang}">${esc(reply.signature)}</div>
  `;
  exchange.appendChild(replyCard);
  threadContainer.appendChild(exchange);

  return {
    bodyEl: replyCard.querySelector('.reply-body'),
    sigEl:  replyCard.querySelector('.reply-sig'),
  };
}

function typeReplyBody(text, run) {
  const characters = Array.from(text);
  let index = 0;

  if (characters.length === 0) {
    finishReplyTyping(text);
    return;
  }

  function typeNext() {
    if (run !== replyTypingRun) return;

    const character = characters[index];
    activeTypingBodyEl.textContent += character;
    index += 1;

    if (index >= characters.length) {
      finishReplyTyping(text);
      return;
    }

    replyTypingTimer = setTimeout(typeNext, typingDelay(character));
  }

  typeNext();
}

function typingDelay(character) {
  if (character === '\n') return 190;
  if (/[.!?]/.test(character)) return 150;
  if (/[,;:—]/.test(character)) return 85;
  return 28;
}

function finishReplyTyping(text) {
  replyTypingRun += 1;
  clearTimeout(replyTypingTimer);
  if (activeTypingBodyEl) {
    activeTypingBodyEl.textContent = text;
    activeTypingBodyEl.classList.remove('is-typing');
  }
  if (activeTypingSigEl) {
    activeTypingSigEl.classList.remove('awaiting-signature');
  }
  readAloudBtn.disabled = false;
  isReplyTyping = false;
  replyTypingTimer = null;
  hideTypingSkip();

  // Scroll the "Write back" button into view once the letter is fully read
  if (!writeBackBtn.classList.contains('hidden')) {
    setTimeout(() => {
      writeBackBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 500);
  }
}

function stopReplyTyping() {
  replyTypingRun += 1;
  clearTimeout(replyTypingTimer);
  replyTypingTimer = null;
  isReplyTyping = false;
  activeReplyBody = '';
  if (activeTypingBodyEl) activeTypingBodyEl.classList.remove('is-typing');
  activeTypingBodyEl = null;
  activeTypingSigEl  = null;
  typingSkip.classList.add('hidden');
  typingSkip.classList.remove('is-leaving');
}

// ---- Write back ------------------------------------------------------

function handleWriteBack() {
  writeBackBtn.classList.add('hidden');
  writeBackTo.textContent = currentConversation.to;
  writeBackCompose.classList.remove('hidden', 'entering');
  void writeBackCompose.offsetWidth;
  writeBackCompose.classList.add('entering');
  setTimeout(() => writeBackBody.focus(), 50);
}

function handleWriteBackSend() {
  const text = writeBackBody.value.trim();
  if (!text) { writeBackBody.focus(); return; }

  const { to, userName, language, voiceRef: voice } = currentConversation;

  sendingEnvelopeTo.textContent = to;
  sendingEnvelopeFrom.textContent = `from ${userName}`;

  cancelPendingSend();
  const run = ++sendRun;
  sendAbortController = new AbortController();

  const replyPromise = fetchReply({
    to,
    userName,
    text,
    voiceRef: voice,
    language,
    history: [...conversationThread],
    signal: sendAbortController.signal,
  }).catch(() => null);

  showSection('sending');
  resetAnimations();

  runSendAnimation(async () => {
    if (run !== sendRun) return;

    const apiData = await replyPromise;
    if (run !== sendRun) return;

    const date = new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });

    let reply;
    if (apiData && apiData.body) {
      reply = {
        date,
        to,
        userName,
        salutation: apiData.salutation || defaultSalutation(userName, language),
        body:       apiData.body,
        signature:  apiData.signature || defaultSignature(to, language),
      };
    } else {
      reply = generateReply({ to, userName, text, voiceRef: voice, language });
    }

    const preview = extractPreview(reply.body);
    await saveToArchive({
      date:            reply.date,
      to,
      userName,
      original:        text,
      preview,
      replyBody:       reply.body,
      replySignature:  reply.signature,
      replySalutation: reply.salutation,
      language,
    });

    // Extend conversation history
    conversationThread.push({ role: 'user', text });
    conversationThread.push({ role: 'assistant', text: reply.body });

    // Fade out "Delivered.", bridge to "A letter has returned."
    sendingCaption.style.opacity = '0';
    await new Promise(resolve => {
      sendAnimationTimers.push(setTimeout(resolve, 550));
    });
    if (run !== sendRun) return;

    sendingCaption.textContent = 'A letter has returned.';
    sendingCaption.style.opacity = '1';

    await new Promise(resolve => {
      sendAnimationTimers.push(setTimeout(resolve, 1600));
    });
    if (run !== sendRun) return;

    // Append new exchange to thread, start typing
    const sentData = { to, userName, body: text, date: reply.date };
    displayReply(sentData, reply);

    writeBackBody.value = '';

    // Return to reply section (suppress entry animation, scroll to new exchange)
    sections.reply.classList.add('no-entry-anim');
    sections.sending.classList.add('hidden');
    sections.reply.classList.remove('hidden');

    writeBackCompose.classList.add('hidden');
    writeBackCompose.classList.remove('entering');
    writeBackBtn.classList.remove('hidden');
    sendAbortController = null;

    setTimeout(() => {
      threadContainer.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
  });
}

function skipReplyTyping() {
  if (!isReplyTyping) return;
  finishReplyTyping(activeReplyBody);
}

function handleTypingShortcut(event) {
  if (!isReplyTyping || (event.key !== ' ' && event.key !== 'Enter')) return;

  const target = event.target;
  const isInteractive = target instanceof HTMLElement && (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName)
  );
  if (isInteractive) return;

  event.preventDefault();
  skipReplyTyping();
}

function hideTypingSkip() {
  typingSkip.classList.add('is-leaving');
  setTimeout(() => {
    if (!isReplyTyping) typingSkip.classList.add('hidden');
  }, 280);
}

function resetReading(clearText = true) {
  if (currentReading) stopReading(currentReading, true);

  if (clearText) currentReplyText = '';
}

// ---- Shared read-aloud controller -----------------------------------

function createReadingController(root, getText) {
  const state = {
    getText,
    audio: root.querySelector('audio'),
    readBtn: root.querySelector('.read-aloud-btn'),
    pauseBtn: root.querySelector('[data-reading-action="pause"]'),
    stopBtn: root.querySelector('[data-reading-action="stop"]'),
    status: root.querySelector('.read-letter-status'),
    voiceInputs: root.querySelectorAll('input[type="radio"]'),
    emotionSelect: root.querySelector('select'),
    url: '',
    loading: false,
    abortController: null,
    stopped: true,
  };

  state.readBtn.addEventListener('click', () => startReading(state));
  state.pauseBtn.addEventListener('click', () => toggleReadingPause(state));
  state.stopBtn.addEventListener('click', () => stopReading(state));
  state.audio.addEventListener('play', () => {
    state.stopped = false;
    updateReadingState(state, 'playing');
  });
  state.audio.addEventListener('pause', () => {
    if (!state.stopped && !state.audio.ended && state.audio.currentTime > 0) {
      updateReadingState(state, 'paused');
    }
  });
  state.audio.addEventListener('ended', () => updateReadingState(state, 'ended'));

  return state;
}

async function startReading(state) {
  const text = state.getText().trim();
  const selectedVoice = Array.from(state.voiceInputs).find(input => input.checked);
  if (!text || !selectedVoice || state.loading) return;

  if (window.location.protocol === 'file:') {
    state.status.textContent = 'Read aloud is available at http://localhost:3000.';
    return;
  }

  if (activeReading && activeReading !== state) stopReading(activeReading, true);
  stopReading(state, true);
  activeReading = state;
  state.loading = true;
  const requestController = new AbortController();
  state.abortController = requestController;
  state.readBtn.disabled = true;
  state.readBtn.textContent = 'Preparing…';
  state.status.textContent = 'Preparing the reading…';

  try {
    const response = await fetch('/api/read-letter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: requestController.signal,
      body: JSON.stringify({
        text,
        voice: selectedVoice.value,
        emotion: state.emotionSelect.value,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'The reading could not be prepared');
    }

    state.url = URL.createObjectURL(await response.blob());
    state.audio.src = state.url;
    state.audio.classList.remove('hidden');
    state.pauseBtn.disabled = false;
    state.stopBtn.disabled = false;
    state.status.textContent = '';

    try {
      await state.audio.play();
    } catch {
      state.status.textContent = 'The reading is ready. Press play when you are ready.';
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    state.status.textContent = err.message || 'The reading could not be prepared.';
    stopReading(state, false, true);
  } finally {
    if (state.abortController === requestController) {
      state.loading = false;
      state.abortController = null;
      state.readBtn.disabled = false;
      state.readBtn.textContent = 'Read aloud';
    }
  }
}

function toggleReadingPause(state) {
  if (!state.audio.src) return;

  if (state.audio.paused) {
    if (activeReading && activeReading !== state) stopReading(activeReading, true);
    activeReading = state;
    state.audio.play().catch(() => {
      state.status.textContent = 'Press play when you are ready.';
    });
  } else {
    state.audio.pause();
  }
}

function stopReading(state, hideAudio = false, keepStatus = false) {
  if (state.abortController) {
    state.abortController.abort();
    state.abortController = null;
  }

  state.loading = false;
  state.stopped = true;
  state.audio.pause();
  state.audio.currentTime = 0;
  state.readBtn.disabled = false;
  state.readBtn.textContent = 'Read aloud';
  state.pauseBtn.textContent = 'Pause';
  state.pauseBtn.disabled = true;
  state.stopBtn.disabled = true;

  if (hideAudio) state.audio.classList.add('hidden');
  if (!keepStatus) state.status.textContent = '';

  if (state.url) {
    URL.revokeObjectURL(state.url);
    state.url = '';
    state.audio.removeAttribute('src');
    state.audio.load();
  }

  if (activeReading === state) activeReading = null;
}

function updateReadingState(state, mode) {
  if (mode === 'playing') {
    activeReading = state;
    state.pauseBtn.textContent = 'Pause';
    state.pauseBtn.disabled = false;
    state.stopBtn.disabled = false;
    state.status.textContent = 'Reading aloud…';
  } else if (mode === 'paused') {
    state.pauseBtn.textContent = 'Resume';
    state.status.textContent = 'Reading paused.';
  } else if (mode === 'ended') {
    state.stopped = true;
    state.pauseBtn.textContent = 'Pause';
    state.pauseBtn.disabled = true;
    state.stopBtn.disabled = false;
    state.status.textContent = 'The reading has finished.';
    if (activeReading === state) activeReading = null;
  }
}

// ---- Mock reply generator -------------------------------------------
// Replace generateReply() with an API call when ready.
// Accepts: { to, userName, text, voiceRef }
// Returns: { date, to, userName, salutation, body, signature }

function generateReply({ to, userName, text, voiceRef = '', language = 'auto' }) {
  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const name = userName || 'you';
  const replyLanguageMode = language === 'auto'
    ? (containsChinese(text) ? 'chinese' : 'english')
    : language;

  const englishBodies = [
    `Your letter arrived.\n\nThere's something in what you wrote that I recognize — not the particulars, but the underneath of them. The part that doesn't quite fit into words even when you're trying.\n\nI don't have an answer that will settle it. But I think you knew that before you sent it, and you wrote anyway. That seems like the part worth noting.`,

    `The line that stayed with me isn't the one you probably meant to write. It's the one just before the end, where you almost stopped.\n\nI don't know if you noticed you did that.\n\nBut I noticed.`,

    `Here is what I can tell you: things move. Even the ones that feel fixed. Even the ones you've stopped watching.\n\nI'm glad you wrote.`,

    `Letters like yours don't come often. I mean that plainly — not as flattery, but as a fact about what it takes to write one.\n\nYou put it into words. You sent it out.\n\nThat's not nothing. In fact it's closer to everything.`,

    `Your letter found me.\n\nThat's not always a given. Sometimes things get lost. Sometimes they arrive too late. Sometimes they're never sent at all.\n\nYou sent yours. It found me. That seems like the whole story.`,

    `I receive a great many things. Silence. An occasional stone. And now this.\n\nI don't have words for all of what you're asking. But you didn't ask for words — you asked to be heard.\n\nYou have been.`,

    `I won't pretend I know what to say to the full weight of it.\n\nBut I want you to know it was received — all of it, including the parts between the lines.\n\nWrite again if you want to.`,
  ];

  const chineseBodies = [
    `你的信到了。\n\n有些话，我不知道该怎样完整地回答。但你写下来的那些迟疑、停顿，还有没有明说的部分，我都收到了。\n\n谢谢你把它寄来。`,
    `我反复想起你信里的一句话。也许那并不是你最想让我记住的那一句，可它留了下来。\n\n有些事情不会因为有了答案就变轻。不过，能这样写给彼此，本身已经很珍贵。`,
    `信纸很安静，可你写下的东西并不安静。\n\n我没有一个恰好合适的回答。只想告诉你：这封信没有落空，它来到了这里。\n\n如果愿意，就再写来吧。`,
  ];

  const bodies = replyLanguageMode === 'chinese' ? chineseBodies : englishBodies;
  const body = bodies[Math.floor(Math.random() * bodies.length)];

  return {
    date,
    to,
    userName: name,
    salutation: defaultSalutation(name, replyLanguageMode),
    body,
    signature: defaultSignature(to, replyLanguageMode),
  };
}

function containsChinese(text) {
  return /[\u3400-\u9fff]/.test(text);
}

function defaultSalutation(name, language) {
  return language === 'chinese' ? `${name}：` : `Dear ${name},`;
}

function defaultSignature(to, language) {
  return language === 'chinese' ? `—— ${to}` : `— ${to}`;
}

// ---- Extract preview (first sentence of reply body) -----------------

function extractPreview(body) {
  const match = body.match(/^[^.!?。！？\n]+[.!?。！？]/);
  const sentence = match ? match[0].trim() : body.split('\n')[0] || '';
  return sentence.length > 88 ? sentence.slice(0, 88).trimEnd() + '…' : sentence;
}

// ---- Archive --------------------------------------------------------
// Primary storage: Supabase (via /api/letters).
// Fallback: session db (db.js) — always available, survives Supabase outages
// or missing credentials so the archive never goes blank mid-session.

async function saveToArchive(entry) {
  // Always write to session db first so the archive works immediately.
  await BetweenUsDB.saveLetter(entry);

  // Also persist to Supabase; non-fatal if unavailable.
  try {
    const res = await fetch('/api/letters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt:    entry.original,
        reply:     entry.replyBody,
        recipient: entry.to,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error('[Archive] Save failed:', res.status, body.error || '');
    }
  } catch (err) {
    console.error('[Archive] Save fetch error:', err.message);
  }
}

async function loadArchive() {
  // Try Supabase first (returns historical letters across sessions).
  try {
    const res = await fetch('/api/letters');
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows)) {
        return { letters: rows.map(mapArchiveRow), storageError: null };
      }
    }
    const body = await res.json().catch(() => ({}));
    const msg = body.error || `Server returned ${res.status}`;
    console.error('[Archive] Cloud fetch failed:', msg);
    return { letters: await BetweenUsDB.loadLetters(), storageError: msg };
  } catch (err) {
    console.error('[Archive] Fetch error:', err.message);
    return { letters: await BetweenUsDB.loadLetters(), storageError: err.message };
  }
}

function mapArchiveRow(row) {
  return {
    id:              row.id,
    date:            formatSupabaseDate(row.created_at),
    to:              row.recipient,
    userName:        getUserName(),
    original:        row.prompt,
    replyBody:       row.reply || '',
    preview:         row.reply ? extractPreview(row.reply) : '',
    replySignature:  null,
    replySalutation: null,
    language:        'auto',
  };
}

function formatSupabaseDate(ts) {
  try {
    return new Date(ts).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch {
    return ts || '';
  }
}

async function renderArchive() {
  archiveList.innerHTML = '';
  archiveEmpty.classList.add('hidden');
  archiveStatus.textContent = '';
  archiveStatus.classList.add('hidden');

  const { letters, storageError } = await loadArchive();

  if (storageError) {
    archiveStatus.textContent = 'Letter storage unavailable. Showing letters from this session only.';
    archiveStatus.classList.remove('hidden');
  }

  if (letters.length === 0) {
    archiveEmpty.classList.remove('hidden');
    return;
  }

  letters.forEach(entry => {
    const card = document.createElement('div');
    card.className = 'env-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute(
      'aria-label',
      `Open letter to ${entry.to}, from ${entry.userName || 'you'}, dated ${entry.date}`,
    );
    card.innerHTML = `
      <div class="env-lid"></div>
      <div class="env-letter-edge" aria-hidden="true">
        <span class="env-paper-fold"></span>
        <span class="env-retrieval">Opening your letter…</span>
      </div>
      <div class="env-address">
        <div class="env-postmark">${esc(entry.date)}</div>
        <div class="env-to">${esc(entry.to)}</div>
        <div class="env-from">from ${esc(entry.userName || 'you')}</div>
      </div>
    `;
    card.addEventListener('click', () => openEnvelope(card, entry));
    card.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openEnvelope(card, entry);
    });
    archiveList.appendChild(card);
  });
}

// ---- Correspondence view --------------------------------------------

function openEnvelope(cardEl, entry) {
  cancelCorrespondenceOpening();

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    displayCorrespondence(entry);
    return;
  }

  const run = correspondenceOpenRun;
  archiveList.classList.add('is-opening');
  cardEl.classList.add('is-selected');

  scheduleCorrespondenceStage(() => {
    if (run !== correspondenceOpenRun) return;
    cardEl.classList.add('is-flap-open');
  }, 150);

  scheduleCorrespondenceStage(() => {
    if (run !== correspondenceOpenRun) return;
    cardEl.classList.add('is-extracting', 'is-retrieving');
  }, 650);

  scheduleCorrespondenceStage(() => {
    if (run !== correspondenceOpenRun) return;
    cardEl.classList.add('is-leaving');
  }, 1320);

  scheduleCorrespondenceStage(() => {
    if (run !== correspondenceOpenRun) return;
    displayCorrespondence(entry);
    correspondenceOpenTimers = [];
  }, 1500);
}

function scheduleCorrespondenceStage(callback, delay) {
  const timer = setTimeout(callback, delay);
  correspondenceOpenTimers.push(timer);
}

function cancelCorrespondenceOpening() {
  correspondenceOpenRun += 1;
  correspondenceOpenTimers.forEach(clearTimeout);
  correspondenceOpenTimers = [];
  archiveList.classList.remove('is-opening');
  archiveList.querySelectorAll('.env-card').forEach(card => {
    card.classList.remove(
      'is-selected',
      'is-flap-open',
      'is-extracting',
      'is-retrieving',
      'is-leaving',
    );
  });
}

function displayCorrespondence(entry) {
  const userName = entry.userName || 'You';
  const originalLang = containsChinese(entry.original || '') ? 'zh-CN' : 'en';
  const replyLang = containsChinese(entry.replyBody || '') ? 'zh-CN' : 'en';
  const salutation = entry.replySalutation || defaultSalutation(
    userName,
    entry.language || 'english',
  );

  corrExchange.innerHTML = `
    <div class="stationery corr-paper">
      <div class="corr-paper-label">Your letter</div>
      <div class="corr-to-line">To: ${esc(entry.to)}</div>
      <div class="corr-body" lang="${originalLang}">${esc(entry.original)}</div>
    </div>
    <div class="corr-sep"><span class="corr-sep-dot"></span></div>
    <div class="stationery corr-paper reply-paper">
      <div class="corr-paper-label">In reply</div>
      <div class="reply-date-line">${esc(entry.date)}</div>
      <div class="reply-address-block">
        <span>To: ${esc(userName)}</span>
        <span>From: ${esc(entry.to)}</span>
      </div>
      <div class="reply-salutation" lang="${replyLang}">${esc(salutation)}</div>
      <div class="reply-body" lang="${replyLang}">${esc(entry.replyBody || '')}</div>
      <div class="reply-sig" lang="${replyLang}">${esc(entry.replySignature || '— ' + entry.to)}</div>
    </div>
    ${readingControlsMarkup('archiveReadingVoice')}
  `;

  const archiveReadControls = corrExchange.querySelector('.archive-read-controls');
  createReadingController(
    archiveReadControls,
    () => entry.replyBody || '',
  );

  showSection('correspondence');
  corrExchange.classList.add('unfolding');
  corrExchange.addEventListener('animationend', () => {
    corrExchange.classList.remove('unfolding');
  }, { once: true });
}

function readingControlsMarkup(voiceName) {
  return `
    <div class="read-letter archive-read-controls">
      <p class="read-letter-label">Read this letter in a voice</p>
      <div class="read-letter-options">
        <div class="voice-choice" role="radiogroup" aria-label="Reading voice">
          <label>
            <input type="radio" name="${voiceName}" value="female" checked>
            <span>Female</span>
          </label>
          <label>
            <input type="radio" name="${voiceName}" value="male">
            <span>Male</span>
          </label>
        </div>
        <label class="emotion-choice">
          <span>Feeling</span>
          <select aria-label="Reading feeling">
            <option value="neutral">Still</option>
            <option value="happy">Warm</option>
            <option value="sad">Wistful</option>
            <option value="surprised">Bright</option>
          </select>
        </label>
      </div>
      <div class="read-letter-actions">
        <button class="read-aloud-btn" type="button">Read aloud</button>
        <button class="reading-action-btn" data-reading-action="pause" type="button" disabled>Pause</button>
        <button class="reading-action-btn" data-reading-action="stop" type="button" disabled>Stop</button>
      </div>
      <p class="read-letter-status" role="status"></p>
      <audio class="letter-audio hidden" controls preload="none"></audio>
    </div>
  `;
}

// ---- Utility --------------------------------------------------------

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- Start -----------------------------------------------------------

init();
