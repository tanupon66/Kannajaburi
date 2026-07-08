import {
  loadState,
  saveState,
  exportState,
  importState,
  dataUrlToBlob,
  formatThaiDate,
  initials,
  scoreFromState,
  uid
} from './state.js';
import { DriveSync } from './drive.js';
import { mediaId, saveMediaBlob, getMediaBlob, mediaBlobUrl } from './mediaStore.js';

let state = loadState();
let currentPage = 'home';
let deferredInstallPrompt = null;
let currentGameDeck = 'most';
let reel = { open: false, index: 0, timer: null };
let syncTimer = null;
let isSyncing = false;
let syncStatus = { text: 'Local cache ready', tone: 'idle' };

const app = document.querySelector('#app');
const toastEl = document.querySelector('#toast');
const drive = new DriveSync({
  getState: () => state,
  saveState: persist,
  toast,
  onStatus: (text, tone = 'info') => {
    syncStatus = { text, tone };
    renderSyncStatusOnly();
  }
});

const NAV = [
  ['home', '🏕️', 'Home'],
  ['feed', '📸', 'Feed'],
  ['quest', '🧭', 'Quest'],
  ['games', '🎲', 'Game'],
  ['recap', '🎞️', 'Recap'],
  ['tools', '🧰', 'More']
];

const QUESTS = [
  { id: 'q001', day: 'Day 1', type: 'Photo', emoji: '📸', xp: 15, title: 'รูปกลุ่มจริงจัง + รูปกลุ่มปั่น', desc: 'ถ่ายรูปทีมครบทุกคน 2 เวอร์ชัน แล้วเลือกลง Memory Wall' },
  { id: 'q002', day: 'Day 1', type: 'Adventure', emoji: '🌊', xp: 25, title: 'Raft Safety Shot', desc: 'ถ่ายรูปใส่เสื้อชูชีพหรือพร้อมเล่นน้ำอย่างปลอดภัย' },
  { id: 'q003', day: 'Day 1', type: 'Social', emoji: '🫶', xp: 20, title: 'งดมือถือ 20 นาที', desc: 'นั่งคุยกันจริง ๆ บนแพ ห้ามจับมือถือ ยกเว้นถ่ายหลักฐานก่อนเริ่ม' },
  { id: 'q004', day: 'Day 1', type: 'Memory', emoji: '🌙', xp: 15, title: 'เสียงกลางคืนบนแพ', desc: 'อัดหรือบันทึกข้อความบรรยากาศตอนกลางคืนไว้เป็นความทรงจำ' },
  { id: 'q005', day: 'Day 2', type: 'Adventure', emoji: '🌉', xp: 25, title: 'Mon Bridge Walker', desc: 'เดินสะพานมอญให้ครบและเช็กอินพร้อมรูปหรือข้อความ' },
  { id: 'q006', day: 'Day 2', type: 'Photo', emoji: '🌅', xp: 20, title: 'โปสเตอร์หนังชีวิต', desc: 'ถ่ายรูปวิวเช้าให้เหมือนปกหนัง/ปกอัลบั้ม แล้วให้เพื่อนตั้งชื่อ' },
  { id: 'q007', day: 'Day 2', type: 'Social', emoji: '🎧', xp: 15, title: 'เพลงประจำเพื่อน', desc: 'เลือกเพลงที่คิดว่าเหมาะกับเพื่อน 1 คน พร้อมเหตุผล' },
  { id: 'q008', day: 'Day 2', type: 'Food', emoji: '🍜', xp: 15, title: 'ของกินตัวตึง', desc: 'ถ่าย/บันทึกเมนูที่อร่อยสุดของวัน แล้วโหวตกัน' },
  { id: 'q009', day: 'Day 3', type: 'Memory', emoji: '💬', xp: 20, title: 'ประโยคที่อยากบอกแก๊งนี้', desc: 'เขียนข้อความสั้น ๆ ที่อยากบอกเพื่อนหลังจบทริป' },
  { id: 'q010', day: 'Day 3', type: 'Vote', emoji: '🏆', xp: 30, title: 'MVP กาญนะจ๊ะบุรี', desc: 'โหวต MVP รวมของทริป พร้อมเหตุผลที่อยากจำไว้' },
  { id: 'q011', day: 'Any', type: 'Chaos', emoji: '😂', xp: 15, title: 'Quote เด็ดประจำทริป', desc: 'เก็บประโยคฮา/ประโยคตำนานที่มีคนพูดระหว่างทริป' },
  { id: 'q012', day: 'Any', type: 'Kindness', emoji: '🤝', xp: 25, title: 'ช่วยเพื่อนแบบไม่บอก', desc: 'ทำเรื่องดี ๆ ให้เพื่อน 1 อย่าง แล้วบันทึกเป็น Secret Buddy' }
];

const MOST_LIKELY = [
  'ใครมีแนวโน้มจะตื่นสายที่สุดในทริปนี้?',
  'ใครมีแนวโน้มจะหลับบนรถภายใน 5 นาที?',
  'ใครมีแนวโน้มจะหายไปถ่ายรูปคนเดียว?',
  'ใครมีแนวโน้มจะเป็นหัวหน้าทริปโดยไม่รู้ตัว?',
  'ใครมีแนวโน้มจะพูดว่า “หิว” บ่อยที่สุด?',
  'ใครมีแนวโน้มจะรวยก่อนเพื่อน?',
  'ใครมีแนวโน้มจะลาออกไปเปิดร้านกาแฟ?',
  'ใครมีแนวโน้มจะได้รูปโปรไฟล์ใหม่จากทริปนี้?',
  'ใครมีแนวโน้มจะลืมของไว้ที่พัก?',
  'ใครมีแนวโน้มจะกลายเป็นตำนานของกาญนะจ๊ะบุรี?'
];

const TRUTH = [
  'ช่วงนี้เหนื่อยกับเรื่องอะไรที่สุด แต่เล่าแบบไม่ดราม่าเกินไป',
  'สิ่งที่ภูมิใจในตัวเองที่สุดหลังเรียนจบ/เริ่มทำงานคืออะไร?',
  'ถ้าย้อนกลับไปบอกตัวเองตอนอายุ 18 ได้ จะบอกอะไร?',
  'ก่อนอายุ 30 อยากทำอะไรให้สำเร็จ 1 อย่าง?',
  'ใครในกลุ่มนี้ทำให้คุณรู้สึกสบายใจที่สุด เพราะอะไร?',
  'งานในฝันจริง ๆ คืออะไร ถ้าไม่ต้องคิดเรื่องเงิน?',
  'ความทรงจำกับแก๊งนี้ที่อยากเก็บไว้คืออะไร?',
  'ถ้าปีหน้าไปทริปอีก อยากไปที่ไหนกับแก๊งนี้?'
];

const MISSIONS = [
  'เลียนแบบเพื่อนในกลุ่ม 10 วินาที แบบไม่แรงเกินไป',
  'พูดขายวิวตรงหน้าให้เหมือนโฆษณารีสอร์ท 15 วินาที',
  'ถ่ายรูปท่าปั่นกับคนข้าง ๆ แล้วลง Memory Wall',
  'ชมเพื่อน 1 คนแบบจริงใจจนเขาเขิน',
  'ให้เพื่อนเลือกแคปชันให้รูปคุณ 1 รูป',
  'เปิดเพลงที่คิดว่าเป็นเพลงประจำแก๊งนี้',
  'ทำท่าโปสเตอร์หนังชีวิตหน้าวิว 1 รูป',
  'หยิบ Quote เด็ดวันนี้แล้วบันทึกลงแอพ'
];

const CAPTION_BATTLE = [
  'ตั้งแคปชันรูปสะพานมอญให้เหมือนคนหมดไฟจากงาน',
  'ตั้งแคปชันรูปบนแพให้เหมือนโฆษณาน้ำดื่ม',
  'ตั้งแคปชันรูปวิวเขื่อนให้เหมือนโพสต์ LinkedIn',
  'ตั้งแคปชันรูปอาหารให้ดูเหมือนร้านมิชลิน',
  'ตั้งแคปชันรูปเผลอเพื่อนให้ดูแพง',
  'ตั้งแคปชันให้รูปกลุ่มแบบเพื่อนสนิท 10 ปี'
];

const BINGO_ITEMS = [
  'มีคนพูดว่า “หิว”', 'มีคนถามว่า “ถึงยัง”', 'มีคนหลับบนรถ', 'สัญญาณมือถือหาย', 'ถ่ายรูปกลุ่มครบทุกคน',
  'เจอหมา/แมว', 'มีคนบ่นร้อน', 'ได้รูปสวยแบบไม่ได้ตั้งใจ', 'มีคนเปิดเพลงเศร้า', 'มีคนซื้อของฝาก',
  'มีคนพูดเรื่องงาน', 'ฝนตก', 'มีคนลืมของ', 'กินเยอะแต่บอกจะลดน้ำหนัก', 'มีคนขออีกช็อต',
  'มีคนพูดว่า “กูไหว”', 'มีคนขอยืมสายชาร์จ', 'มีคนถ่ายรูปอาหารก่อนกิน', 'มีคนเดินหาย', 'มีคนตื่นเช้าแบบเหลือเชื่อ',
  'มีรูปเผลอระดับตำนาน', 'มีคนแกล้งทำเป็นไกด์', 'มีคนมองวิวแล้วเงียบ', 'มีคนอยากอยู่ต่อ', 'มีคนพูดว่า “รูปนี้อย่าลงนะ”'
];

const SAFE_REMINDERS = [
  'เล่นน้ำเฉพาะจุดที่ปลอดภัยและควรใส่เสื้อชูชีพ',
  'ไม่ลงน้ำตอนกลางคืนหรือหลังดื่ม',
  'ถุงกันน้ำ/Power bank/ไฟฉาย ควรอยู่หยิบง่าย',
  'ถ้าแยกกัน ให้มีจุดนัดพบและเวลาเช็กอินชัดเจน'
];

init();

function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(console.warn);
  }
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
  });
  document.addEventListener('click', onClick);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('change', onChange);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && drive.connected && state.settings.liveSyncEnabled) syncDrive({ silent: true }).catch(console.warn);
  });
  render();
  setTimeout(autoConnectDriveOnStart, 500);
}


function persist() {
  saveState(state);
}

async function autoConnectDriveOnStart() {
  if (!state.settings.autoSyncOnStart) return;
  if (!state.settings.driveClientId || !state.settings.driveRootFolderId) return;
  try {
    syncStatus = { text: 'กำลัง Auto sync Drive Hub…', tone: 'info' };
    renderSyncStatusOnly();
    await drive.authorize({ prompt: '' });
    startSyncLoop();
    await syncDrive({ silent: true, uploadPendingFirst: true });
  } catch (error) {
    console.warn('Auto sync skipped:', error);
    state.settings.lastDriveError = error.message || String(error);
    syncStatus = { text: 'แตะ Sync เพื่อเชื่อม Drive', tone: 'idle' };
    persist();
    renderSyncStatusOnly();
  }
}

function startSyncLoop() {
  stopSyncLoop();
  if (!state.settings.liveSyncEnabled) return;
  const interval = Math.max(20, Number(state.settings.syncIntervalSec || 45)) * 1000;
  syncTimer = setInterval(() => {
    if (!document.hidden && drive.connected && !isSyncing) {
      syncDrive({ silent: true, uploadPendingFirst: true }).catch(console.warn);
    }
  }, interval);
}

function stopSyncLoop() {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = null;
}

function syncSummary() {
  const last = state.settings.lastSyncAt ? `ซิงก์ล่าสุด ${formatThaiDate(state.settings.lastSyncAt)}` : 'ยังไม่เคยซิงก์ Drive Hub';
  const pending = countPendingRecords();
  const mode = state.settings.syncMode === 'drive-first' ? 'Drive เป็นศูนย์กลาง' : 'Local';
  const statusText = syncStatus?.text ? ` · ${syncStatus.text}` : '';
  return `${mode} · ${last} · pending ${pending}${statusText}`;
}

function renderSyncStatusOnly() {
  const pill = document.querySelector('#syncPill span');
  if (pill) pill.textContent = syncSummary();
}

function countPendingRecords() {
  let count = 0;
  for (const key of ['members', 'moments', 'reactions', 'votes', 'quotes', 'expenses']) {
    count += (state[key] || []).filter(item => item.storage !== 'drive').length;
  }
  count += (state.moments || []).filter(item => (item.media || []).some(media => media.pendingUpload)).length;
  count += (state.questEvents || []).filter(item => item.storage !== 'drive').length;
  if (state.bingo && state.bingo.storage !== 'drive') count += 1;
  return count;
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

function render() {
  const title = pageTitle(currentPage);
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-badge">📖</div>
          <h1>${escapeHtml(state.trip.title || state.appName)}</h1>
          <p>${escapeHtml(state.trip.subtitle || 'สมุดความทรงจำประจำแก๊ง')}</p>
        </div>
        <nav class="nav">${renderNav()}</nav>
        <div class="sync-pill ${drive.connected ? 'connected' : ''}" id="syncPill">
          <strong>${drive.connected ? '🟢 Drive Hub Connected' : '⚪ Drive-first: รอเชื่อมต่อ'}</strong>
          <span>${syncSummary()}</span>
        </div>
      </aside>
      <main class="main">
        <div class="topbar">
          <div class="page-title">
            <h2>${title.icon} ${title.name}</h2>
            <p>${title.desc}</p>
          </div>
          <div class="action-row">
            <button class="btn accent" data-action="quick-moment">＋ เพิ่มโมเมนต์</button>
            <button class="btn" data-action="sync-drive">☁️ Sync Hub</button>
          </div>
        </div>
        ${renderPage()}
      </main>
      <nav class="mobile-nav">${renderMobileNav()}</nav>
    </div>
    ${reel.open ? renderReel() : ''}
  `;
  hydrateMediaInDOM();
}

function renderNav() {
  return NAV.map(([id, icon, name]) => `
    <button class="${currentPage === id ? 'active' : ''}" data-nav="${id}">
      <span class="ico">${icon}</span><span>${name}</span>
    </button>
  `).join('');
}

function renderMobileNav() {
  return NAV.map(([id, icon, name]) => `
    <button class="${currentPage === id ? 'active' : ''}" data-nav="${id}">
      <span class="ico">${icon}</span><span>${name}</span>
    </button>
  `).join('');
}

function pageTitle(page) {
  return {
    home: { icon: '🏕️', name: 'วันนี้ทำไรดี', desc: 'แดชบอร์ดทริป ภารกิจ คะแนน และปุ่มเริ่มตำนาน' },
    feed: { icon: '📸', name: 'Memory Feed', desc: 'ทุกคนอัปเดตโมเมนต์ เช็กอิน รูป วิดีโอ และ Quote ได้ที่นี่' },
    quest: { icon: '🧭', name: 'ภารกิจแก๊ง', desc: 'ทำเควสต์ ถ่ายคอนเทนต์ เล่นน้ำแบบปลอดภัย และเก็บ XP' },
    games: { icon: '🎲', name: 'เกมบนแพ', desc: 'Most Likely, Truth or Mission, Trip Bingo, Secret Buddy และ Caption Battle' },
    recap: { icon: '🎞️', name: 'สมุดความทรงจำ', desc: 'นำเสนอโมเมนต์รวมแบบ Reel/สไลด์ และสร้าง Recap หลังจบทริป' },
    tools: { icon: '🧰', name: 'ตั้งค่าและเครื่องมือ', desc: 'Google Drive Sync, สมาชิก, หารค่าใช้จ่าย, Checklist และ Backup' }
  }[page];
}

function renderPage() {
  if (currentPage === 'home') return renderHome();
  if (currentPage === 'feed') return renderFeed();
  if (currentPage === 'quest') return renderQuest();
  if (currentPage === 'games') return renderGames();
  if (currentPage === 'recap') return renderRecap();
  return renderTools();
}

function renderHome() {
  const done = Object.keys(state.questsDone || {}).length;
  const moments = state.moments.length;
  const score = scoreFromState(state);
  const topQuests = QUESTS.filter(q => !state.questsDone[q.id]).slice(0, 4);
  return `
    <section class="grid">
      <div class="hero">
        <div class="hero-content">
          <div class="tag">${escapeHtml(state.trip.day)}</div>
          <h2>${escapeHtml(state.trip.mood)}</h2>
          <p>เปิดแอพนี้เหมือนสมุดเก็บความทรงจำของแก๊ง ทุกคนเพิ่มโมเมนต์ เช็กอิน เล่นเกม โหวตเพื่อน และจบด้วย Reel รวมทริปได้ในที่เดียว</p>
          <div class="hero-stats">
            <span class="stat-chip">🧭 เควสต์ ${done}/${QUESTS.length}</span>
            <span class="stat-chip">📸 โมเมนต์ ${moments}</span>
            <span class="stat-chip">🔥 XP ${score}</span>
          </div>
          <div class="action-row">
            <button class="btn accent" data-action="random-quest">สุ่มภารกิจ</button>
            <button class="btn" data-action="start-game">เริ่มเกมกลุ่ม</button>
            <button class="btn" data-action="open-reel">เปิด Memory Reel</button>
          </div>
        </div>
      </div>

      <div class="grid three">
        <div class="card kpi"><b>${state.members.length}</b><span>สมาชิกแก๊ง</span></div>
        <div class="card kpi"><b>${moments}</b><span>โมเมนต์ในสมุด</span></div>
        <div class="card kpi"><b>${score}</b><span>คะแนนรวมทริป</span></div>
      </div>

      <div class="grid two">
        <div class="card pad stack">
          <div class="spread"><h3>ภารกิจแนะนำ</h3><button class="btn ghost" data-nav="quest">ดูทั้งหมด</button></div>
          ${topQuests.map(renderQuestCard).join('') || '<div class="empty">ทำเควสต์ครบแล้ว เก่งมาก 🎉</div>'}
        </div>
        <div class="card pad stack">
          <div class="spread"><h3>สมาชิก</h3><button class="btn ghost" data-action="open-member-modal">เพิ่มสมาชิก</button></div>
          ${renderMembers()}
          <div class="stack">
            <h3>Safety Reminder</h3>
            ${SAFE_REMINDERS.map(x => `<div class="tag">⚠️ ${escapeHtml(x)}</div>`).join('')}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderMembers() {
  if (!state.members.length) return '<div class="empty">ยังไม่มีสมาชิก เพิ่มชื่อเพื่อนก่อนเริ่มเล่นเกม</div>';
  return `<div class="member-list">${state.members.map(m => `
    <span class="member-chip">
      <span class="avatar" style="background:${escapeAttr(m.color || '#0f6b5e')}">${escapeHtml(initials(m.name))}</span>
      <span>${escapeHtml(m.name)}</span>
    </span>
  `).join('')}</div>`;
}

function renderFeed() {
  const sorted = [...state.moments].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return `
    <section class="grid two">
      <form class="card pad stack" data-form="moment">
        <h3>＋ เพิ่มโมเมนต์ / เช็กอิน</h3>
        <div class="grid two">
          <div class="field"><label>ชื่อคนโพสต์</label>${memberSelect('author', state.profile.name || state.members[0]?.name || '')}</div>
          <div class="field"><label>ประเภท</label>
            <select class="select" name="type">
              <option value="moment">โมเมนต์</option>
              <option value="checkin">เช็กอิน</option>
              <option value="quote">Quote เด็ด</option>
            </select>
          </div>
        </div>
        <div class="field"><label>แคปชัน / สิ่งที่อยากจำ</label><textarea class="textarea" name="caption" required placeholder="เช่น คืนนี้บนแพคือที่สุด / รูปนี้ห้ามหาย / ถึงยังวะ"></textarea></div>
        <div class="grid two">
          <div class="field"><label>สถานที่</label><input class="input" name="place" placeholder="เขื่อนเขาแหลม / สะพานมอญ" /></div>
          <div class="field"><label>อารมณ์</label>
            <select class="select" name="mood">
              <option>ตำนาน</option><option>ฮา</option><option>ซึ้ง</option><option>วิวสวย</option><option>เหนื่อยแต่คุ้ม</option><option>ไม่ควรหลุด</option>
            </select>
          </div>
        </div>
        <div class="field"><label>รูป/วิดีโอทั้งอัลบั้ม (เก็บเต็มความละเอียด)</label><input class="input" name="media" type="file" accept="image/*,video/*" multiple /></div>
        <button class="btn primary full" type="submit">บันทึกลงสมุด</button>
        <p class="small muted">รองรับหลายรูป/หลายวิดีโอในโพสต์เดียว อัปโหลดขึ้น Drive ด้วยไฟล์ต้นฉบับเต็มความละเอียด ไม่บีบอัด ไม่ลดขนาด ถ้ายังไม่เชื่อม Drive จะเก็บไฟล์เต็มไว้ในเครื่องก่อนเพื่อรออัปโหลด</p>
      </form>

      <div class="glass pad stack">
        <h3>Drive Hub Control</h3>
        <button class="btn accent full" data-action="sync-drive">☁️ Sync ทุกข้อมูลจาก Drive</button>
        <button class="btn full" data-action="upload-pending">⬆️ ส่ง Local pending เข้า Drive Hub</button>
        <button class="btn full" data-action="open-reel">🎞️ นำเสนอเป็น Memory Reel</button>
        <div class="code">Mode: Drive-first + Local cache<br>Folder ID: ${escapeHtml(state.settings.driveRootFolderId || 'ยังไม่ได้ตั้งค่า')}<br>${escapeHtml(syncSummary())}</div>
      </div>
    </section>
    <section class="grid" style="margin-top:16px">
      <div class="spread"><h3>Memory Wall</h3><span class="tag">${sorted.length} posts</span></div>
      <div class="feed">${sorted.map(renderMomentCard).join('') || '<div class="card empty">ยังไม่มีโมเมนต์ ลองเพิ่มรูปแรกของทริปเลย 📸</div>'}</div>
    </section>
  `;
}

function renderMomentCard(moment) {
  const mediaList = Array.isArray(moment.media) ? moment.media : [];
  const typeIcon = moment.type === 'checkin' ? '📍' : moment.type === 'quote' ? '💬' : '📸';
  const mediaHtml = renderAlbumMedia(mediaList, moment.id);
  const reactions = (state.reactions || []).filter(r => r.momentId === moment.id);
  const reactionText = reactionSummary(reactions);
  const albumText = mediaList.length ? `อัลบั้ม ${mediaList.length} ไฟล์ · Full resolution` : 'ข้อความ/เช็กอิน';
  return `
    <article class="card moment-card">
      <div class="moment-media album-shell">${mediaHtml}</div>
      <div class="moment-body">
        <div class="spread"><span class="tag">${typeIcon} ${escapeHtml(moment.mood || 'โมเมนต์')}</span><span class="small muted">${formatThaiDate(moment.createdAt)}</span></div>
        <h3>${escapeHtml(moment.caption || 'Untitled Moment')}</h3>
        <p>${escapeHtml(moment.place || 'ไม่ระบุสถานที่')} · โดย ${escapeHtml(moment.author || 'ไม่ระบุชื่อ')}</p>
        <p class="small muted">${escapeHtml(albumText)}</p>
        <div class="inline">
          ${['555', 'ตำนาน', 'โคตรวิว', 'เซฟไว้'].map(emoji => `<button class="btn ghost" data-action="react" data-id="${moment.id}" data-emoji="${emoji}">${emoji}</button>`).join('')}
          ${mediaList.length ? `<button class="btn ghost" data-action="download-album" data-id="${moment.id}">⬇️ บันทึกทั้งอัลบั้ม</button>` : ''}
        </div>
        ${reactionText ? `<p class="small muted">${reactionText}</p>` : ''}
      </div>
    </article>
  `;
}

function renderAlbumMedia(mediaList, momentId) {
  if (!mediaList.length) return '<div class="empty album-empty">ไม่มีรูป แต่มีเรื่องให้จำ</div>';
  const klass = mediaList.length === 1 ? 'single' : mediaList.length === 2 ? 'double' : 'multi';
  return `<div class="album-grid ${klass}">${mediaList.map((media, index) => renderMediaItem(media, momentId, index)).join('')}</div>`;
}

function renderMediaItem(media, momentId, index) {
  const name = media?.name || `media-${index + 1}`;
  const full = media?.fullResolution || media?.driveFileId || media?.localBlobId ? 'Full-res' : 'Preview';
  return `
    <figure class="album-item">
      <div class="media-box">${renderMedia(media)}</div>
      <figcaption>
        <span>${escapeHtml(name)}</span>
        <button class="mini-link" data-action="download-media" data-moment-id="${escapeAttr(momentId)}" data-media-index="${index}">บันทึก</button>
      </figcaption>
      <span class="media-badge">${full}</span>
    </figure>
  `;
}

function renderMedia(media) {
  if (!media) return '<span>ไม่มีรูป แต่มีเรื่องให้จำ</span>';
  if (media.localDataUrl) {
    if (media.mimeType?.startsWith('video/')) return `<video controls src="${media.localDataUrl}"></video>`;
    return `<img src="${media.localDataUrl}" alt="moment" loading="lazy" />`;
  }
  if (media.localBlobId) {
    return `<span data-local-blob-id="${escapeAttr(media.localBlobId)}" data-local-mime="${escapeAttr(media.mimeType || '')}" data-drive-fallback-id="${escapeAttr(media.driveFileId || '')}">กำลังโหลดไฟล์เต็มจากเครื่อง…</span>`;
  }
  if (media.driveFileId) {
    return `<span data-drive-file-id="${escapeAttr(media.driveFileId)}" data-drive-mime="${escapeAttr(media.mimeType || '')}">กำลังโหลดจาก Drive…</span>`;
  }
  return '<span>ไฟล์นี้อยู่ใน Drive/เครื่องอื่น</span>';
}

function renderQuest() {
  const groups = groupBy(QUESTS, q => q.day);
  return `
    <section class="grid">
      <div class="card pad stack">
        <div class="spread"><h3>Quest Passport</h3><button class="btn accent" data-action="random-quest">สุ่มภารกิจ</button></div>
        <p class="muted">กดทำสำเร็จเพื่อเก็บ XP แล้วเพิ่มรูปหรือข้อความใน Memory Feed ได้</p>
      </div>
      ${Object.entries(groups).map(([day, quests]) => `
        <div class="card pad stack">
          <div class="spread"><h3>${escapeHtml(day)}</h3><span class="tag">${quests.filter(q => state.questsDone[q.id]).length}/${quests.length}</span></div>
          <div class="grid auto">${quests.map(renderQuestCard).join('')}</div>
        </div>
      `).join('')}
    </section>
  `;
}

function renderQuestCard(q) {
  const done = Boolean(state.questsDone[q.id]);
  return `
    <div class="quest-card ${done ? 'done' : ''}">
      <div class="quest-head">
        <div class="quest-emoji">${q.emoji}</div>
        <div><h4 class="quest-title">${escapeHtml(q.title)}</h4><p class="quest-desc">${escapeHtml(q.desc)}</p></div>
      </div>
      <div class="spread"><span class="tag">${escapeHtml(q.type)} · +${q.xp} XP</span><button class="btn ${done ? 'ghost' : 'primary'}" data-action="toggle-quest" data-id="${q.id}">${done ? 'ทำแล้ว ✓' : 'ทำสำเร็จ'}</button></div>
    </div>
  `;
}

function renderGames() {
  return `
    <section class="grid two">
      <div class="card pad stack">
        <h3>🎲 Card Game</h3>
        <div class="field"><label>เลือกเกม</label>
          <select class="select" id="gameDeck">
            <option value="most" ${currentGameDeck === 'most' ? 'selected' : ''}>ใครมีแนวโน้มว่า…</option>
            <option value="truth" ${currentGameDeck === 'truth' ? 'selected' : ''}>Truth</option>
            <option value="mission" ${currentGameDeck === 'mission' ? 'selected' : ''}>Mission</option>
            <option value="caption" ${currentGameDeck === 'caption' ? 'selected' : ''}>Caption Battle</option>
          </select>
        </div>
        <div class="game-stage">
          <div>
            <p class="game-card-text" id="gameText">กดเปิดการ์ดเพื่อเริ่มตำนาน</p>
            <p class="game-card-sub" id="gameSub">เหมาะกับเล่นบนแพ ตอนกลางคืน หรือระหว่างรออาหาร</p>
          </div>
        </div>
        <button class="btn accent full" data-action="draw-card">เปิดการ์ด</button>
        <button class="btn full" data-action="save-game-moment">บันทึกการ์ดนี้เป็นโมเมนต์</button>
      </div>

      <div class="card pad stack">
        <div class="spread"><h3>🕵️ Secret Buddy</h3><button class="btn ghost" data-action="make-secret-buddy">สุ่มใหม่</button></div>
        ${renderSecretBuddy()}
      </div>
    </section>
    <section class="card pad stack" style="margin-top:16px">
      <div class="spread"><h3>Trip Bingo</h3><button class="btn accent" data-action="make-bingo">สร้างบิงโก</button></div>
      ${renderBingo()}
    </section>
    <section class="card pad stack" style="margin-top:16px">
      <h3>🏆 โหวตเพื่อนประจำวัน</h3>
      <form class="grid two" data-form="vote">
        <div class="field"><label>หัวข้อโหวต</label><input class="input" name="title" required placeholder="เช่น MVP ประจำวัน / คนฮาที่สุด / คนหลับไวสุด" /></div>
        <div class="field"><label>ผู้ชนะ</label>${memberSelect('winner', '')}</div>
        <div class="field" style="grid-column:1/-1"><label>เหตุผล</label><input class="input" name="reason" placeholder="เพราะขึ้นรถ 5 นาทีหลับเลย" /></div>
        <button class="btn primary" type="submit">บันทึกผลโหวต</button>
      </form>
      ${state.votes.slice(-5).reverse().map(v => `<div class="quest-card"><b>${escapeHtml(v.title)}</b><p class="quest-desc">ผู้ชนะ: ${escapeHtml(v.winner)} — ${escapeHtml(v.reason || '')}</p></div>`).join('')}
    </section>
  `;
}

function renderSecretBuddy() {
  if (!state.members.length) return '<div class="empty">เพิ่มสมาชิกก่อน แล้วค่อยสุ่มภารกิจลับ</div>';
  if (!state.secretBuddy) return '<div class="empty">ยังไม่ได้สุ่ม Secret Buddy วันนี้</div>';
  return `
    <div class="quest-card">
      <span class="tag">ภารกิจลับ</span>
      <h3>${escapeHtml(state.secretBuddy.player)}</h3>
      <p class="quest-desc">${escapeHtml(state.secretBuddy.mission)}</p>
      <button class="btn primary" data-action="complete-secret-buddy">ทำสำเร็จ +25 XP</button>
    </div>
  `;
}

function renderBingo() {
  if (!state.bingo?.cells?.length) return '<div class="empty">กดสร้างบิงโก แล้วเริ่มล่าโมเมนต์ระหว่างทริป</div>';
  return `<div class="bingo-grid">${state.bingo.cells.map((cell, i) => `
    <button class="bingo-cell ${cell.marked ? 'marked' : ''}" data-action="mark-bingo" data-index="${i}">${escapeHtml(cell.text)}</button>
  `).join('')}</div>`;
}

function renderRecap() {
  const bestMoments = [...state.moments].slice(-9).reverse();
  const quoteList = state.quotes.slice(-8).reverse();
  const doneCount = Object.keys(state.questsDone || {}).length;
  return `
    <section class="grid">
      <div class="hero">
        <div class="hero-content">
          <div class="tag">Memory Book Mode</div>
          <h2>กาญนะจ๊ะบุรี Recap</h2>
          <p>รวมโมเมนต์ รูป เช็กอิน Quote คะแนน และผลโหวต เป็นสไลด์นำเสนอแบบวิดีโอ/สมุดความทรงจำ เปิดบนมือถือหรือแคสต์ขึ้นจอได้</p>
          <div class="action-row">
            <button class="btn accent" data-action="open-reel">▶️ เปิด Memory Reel</button>
            <button class="btn" data-action="export-recap">⬇️ Export Recap HTML</button>
          </div>
        </div>
      </div>
      <div class="grid three">
        <div class="card kpi"><b>${state.moments.length}</b><span>โมเมนต์</span></div>
        <div class="card kpi"><b>${doneCount}</b><span>เควสต์สำเร็จ</span></div>
        <div class="card kpi"><b>${state.votes.length}</b><span>ผลโหวต</span></div>
      </div>
      <div class="grid two">
        <div class="card pad stack">
          <h3>รูป/โมเมนต์ล่าสุด</h3>
          <div class="feed">${bestMoments.map(renderMomentCard).join('') || '<div class="empty">ยังไม่มีรูปสำหรับ Recap</div>'}</div>
        </div>
        <div class="card pad stack">
          <h3>Quote เด็ดประจำทริป</h3>
          <form class="inline" data-form="quote">
            <input class="input" name="text" required placeholder="เช่น รูปนี้อย่าลงนะ" style="flex:1; min-width:220px" />
            <button class="btn primary">เพิ่ม Quote</button>
          </form>
          ${quoteList.map(q => `<div class="quest-card"><b>“${escapeHtml(q.text)}”</b><p class="quest-desc">โดย ${escapeHtml(q.author || 'แก๊งนี้')} · ${formatThaiDate(q.createdAt)}</p></div>`).join('') || '<div class="empty">ยังไม่มี Quote เด็ด</div>'}
        </div>
      </div>
    </section>
  `;
}

function renderTools() {
  const total = state.expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  return `
    <section class="grid two">
      <div class="card pad stack">
        <h3>☁️ Google Drive Sync</h3>
        <p class="muted">ใช้ Google Drive เป็นศูนย์กลางข้อมูลของทริป ทุกคนที่มีสิทธิ์ Editor ในโฟลเดอร์เดียวกันจะเห็น Feed, สมาชิก, โหวต, Quote, ค่าใช้จ่าย, Quest และ Bingo ร่วมกัน</p>
        <form class="stack" data-form="settings">
          <div class="field"><label>Google OAuth Client ID</label><input class="input" name="driveClientId" value="${escapeAttr(state.settings.driveClientId)}" placeholder="xxxxx.apps.googleusercontent.com" /></div>
          <div class="field"><label>Trip Drive Folder ID หรือ URL โฟลเดอร์</label><input class="input" name="driveRootFolderId" value="${escapeAttr(state.settings.driveRootFolderId)}" placeholder="https://drive.google.com/drive/folders/..." /></div>
          <div class="field"><label>ชื่อโฟลเดอร์ถ้าจะให้แอพสร้างใหม่</label><input class="input" name="driveRootFolderName" value="${escapeAttr(state.settings.driveRootFolderName)}" /></div>
          <label class="checkline"><input type="checkbox" name="autoSyncOnStart" ${state.settings.autoSyncOnStart ? 'checked' : ''}> Auto sync ตอนเปิดแอพ</label>
          <label class="checkline"><input type="checkbox" name="liveSyncEnabled" ${state.settings.liveSyncEnabled ? 'checked' : ''}> Live sync ทุก ${Number(state.settings.syncIntervalSec || 45)} วินาทีเมื่อเปิดแอพอยู่</label>
          <button class="btn primary" type="submit">บันทึกการตั้งค่า</button>
        </form>
        <div class="grid two">
          <button class="btn accent" data-action="connect-drive">เชื่อมต่อ Drive</button>
          <button class="btn" data-action="create-drive-folder">สร้างโฟลเดอร์ทริป</button>
          <button class="btn" data-action="sync-drive">Sync Drive Hub</button>
          <button class="btn" data-action="upload-pending">ส่ง Pending เข้า Hub</button>
        </div>
        <div class="code">สถานะ: ${drive.connected ? 'Connected' : 'Not connected'}<br>Folder: ${escapeHtml(state.settings.driveRootFolderId || '-')}<br>${escapeHtml(syncSummary())}</div>
      </div>

      <div class="card pad stack">
        <h3>👥 สมาชิกแก๊ง</h3>
        <form class="grid two" data-form="member">
          <div class="field"><label>ชื่อเล่น</label><input class="input" name="name" required placeholder="เช่น บอส" /></div>
          <div class="field"><label>สาย</label><select class="select" name="role"><option>สายคอนเทนต์</option><option>สายฮา</option><option>สายกิน</option><option>สายหลับ</option><option>สายเปย์</option><option>สายไกด์</option></select></div>
          <div class="field"><label>สี</label><input class="input" name="color" type="color" value="#0f6b5e" /></div>
          <button class="btn primary" type="submit">เพิ่มสมาชิก</button>
        </form>
        ${renderMembers()}
      </div>
    </section>

    <section class="grid two" style="margin-top:16px">
      <div class="card pad stack">
        <h3>💸 หารค่าใช้จ่าย</h3>
        <form class="grid two" data-form="expense">
          <div class="field"><label>รายการ</label><input class="input" name="title" required placeholder="ค่าแพ / ค่าเรือ / ค่าอาหาร" /></div>
          <div class="field"><label>จำนวนเงิน</label><input class="input" name="amount" required type="number" min="0" step="0.01" /></div>
          <div class="field"><label>คนจ่าย</label>${memberSelect('payer', '')}</div>
          <button class="btn primary" type="submit">เพิ่มรายการ</button>
        </form>
        <div class="spread"><b>รวมทั้งหมด</b><b>${money(total)}</b></div>
        ${state.expenses.slice(-6).reverse().map(e => `<div class="quest-card"><b>${escapeHtml(e.title)} · ${money(e.amount)}</b><p class="quest-desc">จ่ายโดย ${escapeHtml(e.payer || '-')} · คนละประมาณ ${money(state.members.length ? e.amount / state.members.length : e.amount)}</p></div>`).join('') || '<div class="empty">ยังไม่มีค่าใช้จ่าย</div>'}
      </div>

      <div class="card pad stack">
        <h3>✅ Checklist + Backup</h3>
        ${['เสื้อผ้า', 'ผ้าเช็ดตัว', 'ยากันยุง', 'Power bank', 'ถุงกันน้ำ', 'รองเท้าแตะ/ลุยน้ำ', 'ยาประจำตัว', 'ไฟฉาย', 'สายชาร์จ', 'ลำโพงพกพา'].map((x, i) => `<label class="quest-card"><span><input type="checkbox" data-action="checklist" data-index="${i}"> ${escapeHtml(x)}</span></label>`).join('')}
        <div class="grid two">
          <button class="btn" data-action="export-state">Export Backup</button>
          <label class="btn" for="importStateInput">Import Backup</label>
          <input id="importStateInput" type="file" accept="application/json" hidden />
          <button class="btn accent" data-action="install-app">ติดตั้งแอพ</button>
          <button class="btn danger" data-action="reset-local">ล้างข้อมูล Local</button>
        </div>
      </div>
    </section>
  `;
}

function renderReel() {
  const items = buildReelItems();
  const item = items[reel.index % items.length];
  const media = item.media?.[0];
  return `
    <div class="reel">
      <div class="reel-card">
        <div class="reel-visual">
          ${renderReelMedia(media)}
          <div class="reel-caption">
            <span class="tag">${escapeHtml(item.kicker || 'กาญนะจ๊ะบุรีทริป')}</span>
            <h2>${escapeHtml(item.title)}</h2>
            <p>${escapeHtml(item.text || '')}</p>
          </div>
        </div>
        <div class="reel-controls">
          <button class="btn" data-action="close-reel">ปิด</button>
          <button class="btn" data-action="prev-reel">ก่อนหน้า</button>
          <div class="progress"><span style="width:${((reel.index + 1) / items.length) * 100}%"></span></div>
          <button class="btn accent" data-action="next-reel">ถัดไป</button>
        </div>
      </div>
    </div>
  `;
}

function renderReelMedia(media) {
  if (!media) return '';
  if (media.localDataUrl) {
    if (media.mimeType?.startsWith('video/')) return `<video autoplay muted loop playsinline src="${media.localDataUrl}"></video>`;
    return `<img src="${media.localDataUrl}" alt="reel" />`;
  }
  if (media.localBlobId) return `<span data-local-blob-id="${escapeAttr(media.localBlobId)}" data-local-mime="${escapeAttr(media.mimeType || '')}" data-drive-fallback-id="${escapeAttr(media.driveFileId || '')}"></span>`;
  if (media.driveFileId) return `<span data-drive-file-id="${escapeAttr(media.driveFileId)}" data-drive-mime="${escapeAttr(media.mimeType || '')}"></span>`;
  return '';
}

function buildReelItems() {
  const cover = [{ kicker: 'Memory Reel', title: state.trip.title, text: state.trip.subtitle, media: [] }];
  const moments = [...state.moments].sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt)).map(m => ({
    kicker: `${m.author || 'แก๊งนี้'} · ${m.place || 'กาญจนบุรี'}`,
    title: m.caption || 'โมเมนต์ที่อยากจำ',
    text: `${m.mood || 'ตำนาน'} · ${formatThaiDate(m.createdAt)}`,
    media: m.media || []
  }));
  const votes = state.votes.slice(-5).map(v => ({ kicker: 'Vote Award', title: v.title, text: `${v.winner} — ${v.reason || 'ตำนานประจำทริป'}`, media: [] }));
  const end = [{ kicker: 'Trip Recap', title: `XP รวม ${scoreFromState(state)}`, text: `โมเมนต์ ${state.moments.length} · เควสต์ ${Object.keys(state.questsDone).length}/${QUESTS.length} · สมาชิก ${state.members.length}`, media: [] }];
  return [...cover, ...moments, ...votes, ...end];
}

async function onClick(event) {
  const navBtn = event.target.closest('[data-nav]');
  if (navBtn) {
    currentPage = navBtn.dataset.nav;
    render();
    return;
  }
  const btn = event.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  try {
    if (action === 'quick-moment') { currentPage = 'feed'; render(); return; }
    if (action === 'start-game') { currentPage = 'games'; render(); return; }
    if (action === 'toggle-quest') return toggleQuest(btn.dataset.id);
    if (action === 'random-quest') return randomQuest();
    if (action === 'draw-card') return drawCard();
    if (action === 'save-game-moment') return saveCurrentGameAsMoment();
    if (action === 'make-bingo') return makeBingo();
    if (action === 'mark-bingo') return markBingo(Number(btn.dataset.index));
    if (action === 'make-secret-buddy') return makeSecretBuddy();
    if (action === 'complete-secret-buddy') return completeSecretBuddy();
    if (action === 'react') return reactToMoment(btn.dataset.id, btn.dataset.emoji);
    if (action === 'download-media') return downloadMomentMedia(btn.dataset.momentId, Number(btn.dataset.mediaIndex || 0));
    if (action === 'download-album') return downloadMomentAlbum(btn.dataset.id);
    if (action === 'connect-drive') return connectDrive();
    if (action === 'create-drive-folder') return createDriveFolder();
    if (action === 'sync-drive') return syncDrive();
    if (action === 'upload-pending') return uploadPendingMoments();
    if (action === 'open-reel') return openReel();
    if (action === 'close-reel') return closeReel();
    if (action === 'next-reel') return moveReel(1);
    if (action === 'prev-reel') return moveReel(-1);
    if (action === 'export-state') return exportState(state);
    if (action === 'export-recap') return exportRecapHtml();
    if (action === 'install-app') return installApp();
    if (action === 'reset-local') return resetLocal();
    if (action === 'open-member-modal') { currentPage = 'tools'; render(); return; }
  } catch (error) {
    console.error(error);
    toast(error.message || 'เกิดข้อผิดพลาด');
  }
}

async function onSubmit(event) {
  const form = event.target.closest('[data-form]');
  if (!form) return;
  event.preventDefault();
  const type = form.dataset.form;
  try {
    if (type === 'member') return addMember(new FormData(form), form);
    if (type === 'moment') return addMoment(new FormData(form), form);
    if (type === 'settings') return saveSettings(new FormData(form));
    if (type === 'expense') return addExpense(new FormData(form), form);
    if (type === 'quote') return addQuote(new FormData(form), form);
    if (type === 'vote') return addVote(new FormData(form), form);
  } catch (error) {
    console.error(error);
    toast(error.message || 'บันทึกไม่สำเร็จ');
  }
}

async function onChange(event) {
  if (event.target.id === 'gameDeck') {
    currentGameDeck = event.target.value;
    toast('เปลี่ยนเกมแล้ว');
  }
  if (event.target.id === 'importStateInput') {
    const file = event.target.files?.[0];
    if (!file) return;
    state = await importState(file);
    persist();
    toast('นำเข้า Backup สำเร็จ');
    render();
  }
}

async function addMember(data, form) {
  const name = String(data.get('name') || '').trim();
  if (!name) return;
  const member = {
    id: uid('member'),
    name,
    role: data.get('role') || 'สายคอนเทนต์',
    color: data.get('color') || '#0f6b5e',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    storage: 'local'
  };
  state.members.push(member);
  if (!state.profile.name) state.profile.name = name;
  persist();
  await uploadRecordIfConnected('members', member);
  form.reset();
  toast(`เพิ่ม ${name} แล้ว`);
  render();
}

async function addMoment(data, form) {
  const files = data.getAll('media').filter(file => file && file.size);
  const author = String(data.get('author') || state.profile.name || 'แก๊งนี้').trim();
  let moment = {
    id: uid('moment'),
    type: data.get('type') || 'moment',
    author,
    caption: String(data.get('caption') || '').trim(),
    place: String(data.get('place') || '').trim(),
    mood: data.get('mood') || 'ตำนาน',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    media: [],
    storage: 'local'
  };

  for (const file of files) {
    const blobId = mediaId('fullres');
    await saveMediaBlob(blobId, file, {
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      lastModified: file.lastModified
    });
    moment.media.push({
      id: blobId,
      localBlobId: blobId,
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      lastModified: file.lastModified,
      fullResolution: true,
      pendingUpload: true
    });
  }

  if (drive.connected && state.settings.driveRootFolderId && moment.media.length) {
    moment = await uploadMomentWithStoredMedia(moment);
  } else if (drive.connected && state.settings.driveRootFolderId) {
    await uploadMomentRecordIfConnected(moment);
  }

  state.moments.push(moment);
  if (moment.type === 'quote') {
    const quote = { id: uid('quote'), text: moment.caption, author, createdAt: moment.createdAt, updatedAt: moment.updatedAt, storage: moment.storage };
    state.quotes.push(quote);
    await uploadRecordIfConnected('quotes', quote);
  }
  persist();
  form.reset();
  const fileText = files.length ? ` พร้อมไฟล์เต็มความละเอียด ${files.length} ไฟล์` : '';
  toast(drive.connected ? `บันทึกและส่งขึ้น Drive Hub แล้ว${fileText}` : `บันทึกในเครื่องแล้ว${fileText} รอส่งเข้า Drive Hub`);
  render();
}

async function uploadMomentWithStoredMedia(moment) {
  const children = await drive.ensureStructure();
  const remoteMoment = structuredClone(moment);
  remoteMoment.storage = 'drive';
  remoteMoment.updatedAt = new Date().toISOString();
  remoteMoment.syncedAt = remoteMoment.updatedAt;
  remoteMoment.media = [];

  const localBlobIds = [];
  for (const media of moment.media || []) {
    localBlobIds.push(media.localBlobId || '');
    if (media.driveFileId) {
      remoteMoment.media.push(stripTransientMedia({ ...media, pendingUpload: false, fullResolution: true }));
      continue;
    }

    let blob = null;
    if (media.localBlobId) blob = await getMediaBlob(media.localBlobId);
    if (!blob && media.localDataUrl) blob = dataUrlToBlob(media.localDataUrl);

    if (!blob) {
      remoteMoment.media.push({ ...media, pendingUpload: true });
      continue;
    }

    const mediaFile = await drive.uploadBlob(
      children.media,
      blob,
      `${remoteMoment.id}-${safeFileName(media.name || media.localBlobId || 'media')}`,
      media.mimeType || blob.type || 'application/octet-stream'
    );
    remoteMoment.media.push({
      id: media.id || media.localBlobId || mediaFile.id,
      driveFileId: mediaFile.id,
      name: mediaFile.name,
      originalName: media.name || mediaFile.name,
      mimeType: mediaFile.mimeType || media.mimeType || blob.type,
      size: media.size || blob.size || 0,
      webViewLink: mediaFile.webViewLink,
      thumbnailLink: mediaFile.thumbnailLink,
      fullResolution: true,
      pendingUpload: false
    });
  }

  const uploadPayload = {
    ...remoteMoment,
    media: (remoteMoment.media || []).map(stripTransientMedia)
  };
  await drive.uploadRecord('moments', uploadPayload);

  const localMoment = structuredClone(remoteMoment);
  localMoment.media = (localMoment.media || []).map((media, index) => localBlobIds[index] ? { ...media, localBlobId: localBlobIds[index] } : media);
  return localMoment;
}

function stripTransientMedia(media = {}) {
  const { localBlobId, localDataUrl, ...clean } = media;
  return clean;
}

function saveSettings(data) {
  state.settings.driveClientId = String(data.get('driveClientId') || '').trim();
  state.settings.driveRootFolderId = extractDriveFolderId(String(data.get('driveRootFolderId') || '').trim());
  state.settings.driveRootFolderName = String(data.get('driveRootFolderName') || 'กาญนะจ๊ะบุรีทริป - Shared Memories').trim();
  state.settings.autoSyncOnStart = data.get('autoSyncOnStart') === 'on';
  state.settings.liveSyncEnabled = data.get('liveSyncEnabled') === 'on';
  state.settings.syncMode = 'drive-first';
  state.settings.driveChildren = {};
  persist();
  if (state.settings.liveSyncEnabled && drive.connected) startSyncLoop();
  else stopSyncLoop();
  toast('บันทึกการตั้งค่าแล้ว');
  render();
}

async function addExpense(data, form) {
  const expense = {
    id: uid('expense'),
    title: String(data.get('title') || '').trim(),
    amount: Number(data.get('amount') || 0),
    payer: String(data.get('payer') || '').trim(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    storage: 'local'
  };
  state.expenses.push(expense);
  persist();
  await uploadRecordIfConnected('expenses', expense);
  form.reset();
  toast('เพิ่มค่าใช้จ่ายแล้ว');
  render();
}

async function addQuote(data, form) {
  const text = String(data.get('text') || '').trim();
  if (!text) return;
  const now = new Date().toISOString();
  const author = state.profile.name || state.members[0]?.name || 'แก๊งนี้';
  const quote = { id: uid('quote'), text, author, createdAt: now, updatedAt: now, storage: 'local' };
  const moment = { id: uid('moment'), type: 'quote', author, caption: text, place: 'Quote ประจำทริป', mood: 'ตำนาน', createdAt: now, updatedAt: now, media: [], storage: 'local' };
  state.quotes.push(quote);
  state.moments.push(moment);
  persist();
  await Promise.all([uploadRecordIfConnected('quotes', quote), uploadMomentRecordIfConnected(moment)]);
  form.reset();
  toast('เพิ่ม Quote แล้ว');
  render();
}

async function addVote(data, form) {
  const now = new Date().toISOString();
  const vote = {
    id: uid('vote'),
    title: String(data.get('title') || '').trim(),
    winner: String(data.get('winner') || '').trim(),
    reason: String(data.get('reason') || '').trim(),
    createdAt: now,
    updatedAt: now,
    storage: 'local'
  };
  const moment = { id: uid('moment'), type: 'vote', author: 'Vote Battle', caption: `${vote.title}: ${vote.winner}`, place: vote.reason, mood: 'รางวัลประจำวัน', createdAt: now, updatedAt: now, media: [], storage: 'local' };
  state.votes.push(vote);
  state.moments.push(moment);
  persist();
  await Promise.all([uploadRecordIfConnected('votes', vote), uploadMomentRecordIfConnected(moment)]);
  form.reset();
  toast('บันทึกผลโหวตแล้ว');
  render();
}

async function toggleQuest(id) {
  const done = !state.questsDone[id];
  const now = new Date().toISOString();
  if (done) state.questsDone[id] = now;
  else delete state.questsDone[id];
  const questEvent = {
    id: uid('quest'),
    questId: id,
    done,
    completedAt: done ? now : '',
    author: state.profile.name || 'แก๊งนี้',
    createdAt: now,
    updatedAt: now,
    storage: 'local'
  };
  state.questEvents ||= [];
  state.questEvents.push(questEvent);
  persist();
  await uploadRecordIfConnected('quests', questEvent);
  toast(done ? 'เควสต์สำเร็จ +XP' : 'ยกเลิกเควสต์แล้ว');
  render();
}

function randomQuest() {
  const remaining = QUESTS.filter(q => !state.questsDone[q.id]);
  const pool = remaining.length ? remaining : QUESTS;
  const q = pick(pool);
  currentPage = 'quest';
  toast(`ภารกิจ: ${q.title}`);
  render();
}

function drawCard() {
  const decks = { most: MOST_LIKELY, truth: TRUTH, mission: MISSIONS, caption: CAPTION_BATTLE };
  const text = pick(decks[currentGameDeck] || MOST_LIKELY);
  const gameText = document.querySelector('#gameText');
  const gameSub = document.querySelector('#gameSub');
  if (gameText) gameText.textContent = text;
  if (gameSub) gameSub.textContent = `เกม: ${document.querySelector('#gameDeck')?.selectedOptions?.[0]?.textContent || 'Card Game'}`;
  sessionStorage.setItem('currentGameCard', text);
}

async function saveCurrentGameAsMoment() {
  const text = sessionStorage.getItem('currentGameCard');
  if (!text) return toast('เปิดการ์ดก่อนค่อยบันทึก');
  const moment = { id: uid('moment'), type: 'game', author: 'Game Card', caption: text, place: 'เกมบนแพ', mood: 'ฮา', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), media: [], storage: 'local' };
  state.moments.push(moment);
  persist();
  await uploadMomentRecordIfConnected(moment);
  toast('บันทึกการ์ดเป็นโมเมนต์แล้ว');
  render();
}

async function makeBingo() {
  const cells = shuffle(BINGO_ITEMS).slice(0, 25).map(text => ({ text, marked: false }));
  cells[12] = { text: 'FREE: กาญนะจ๊ะบุรี', marked: true };
  state.bingo = { id: 'shared-bingo', type: 'bingo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), cells, storage: 'local' };
  persist();
  await uploadRecordIfConnected('games', state.bingo);
  toast('สร้าง Trip Bingo แล้ว');
  render();
}

async function markBingo(index) {
  if (!state.bingo?.cells?.[index]) return;
  state.bingo.cells[index].marked = !state.bingo.cells[index].marked;
  state.bingo.updatedAt = new Date().toISOString();
  state.bingo.storage = 'local';
  persist();
  await uploadRecordIfConnected('games', state.bingo);
  if (hasBingo(state.bingo.cells)) toast('BINGO! นักล่าโมเมนต์ตัวจริง');
  render();
}

function makeSecretBuddy() {
  if (!state.members.length) return toast('เพิ่มสมาชิกก่อน');
  const player = pick(state.members).name;
  const targets = state.members.filter(m => m.name !== player);
  const target = targets.length ? pick(targets).name : 'เพื่อนในแก๊ง';
  const missions = [
    `ทำให้ ${target} หัวเราะโดยห้ามบอกว่าเป็นภารกิจ`,
    `ถ่ายรูปเผลอ ${target} ให้ดูดี`,
    `ช่วยถือของหรือดูแล ${target} แบบเนียน ๆ`,
    `ชวน ${target} คุยเรื่องที่อยากทำก่อนอายุ 30`,
    `ทำให้ ${target} ได้รูปโปรไฟล์ใหม่`,
    `ชม ${target} แบบจริงใจจนเขางง`
  ];
  state.secretBuddy = { id: uid('secret'), player, target, mission: pick(missions), createdAt: new Date().toISOString() };
  persist();
  toast('สุ่ม Secret Buddy แล้ว');
  render();
}

async function completeSecretBuddy() {
  if (!state.secretBuddy) return;
  const moment = { id: uid('moment'), type: 'secret', author: state.secretBuddy.player, caption: `Secret Buddy สำเร็จ: ${state.secretBuddy.mission}`, place: 'ภารกิจลับ', mood: 'อบอุ่น', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), media: [], storage: 'local' };
  state.moments.push(moment);
  state.secretBuddy = null;
  persist();
  await uploadMomentRecordIfConnected(moment);
  toast('Secret Buddy สำเร็จ +25 XP');
  render();
}

async function reactToMoment(momentId, emoji) {
  const reaction = { id: uid('reaction'), momentId, emoji, author: state.profile.name || 'เพื่อน', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), storage: 'local' };
  state.reactions.push(reaction);
  persist();
  toast(`React: ${emoji}`);
  await uploadRecordIfConnected('reactions', reaction);
  render();
}

async function connectDrive() {
  await drive.authorize({ prompt: 'consent' });
  if (state.settings.driveRootFolderId) await drive.ensureStructure();
  persist();
  startSyncLoop();
  await syncDrive({ silent: true, uploadPendingFirst: true });
  render();
}

async function createDriveFolder() {
  await drive.authorize({ prompt: drive.connected ? '' : 'consent' });
  const folder = await drive.createTripFolder(state.settings.driveRootFolderName);
  toast(`สร้างโฟลเดอร์แล้ว: ${folder.name}`);
  startSyncLoop();
  await uploadPendingMoments({ silent: true });
  render();
}

async function syncDrive(options = {}) {
  const { silent = false, uploadPendingFirst = false } = options;
  if (isSyncing) return;
  if (!state.settings.driveClientId) {
    if (!silent) toast('กรุณาใส่ Google OAuth Client ID ก่อน');
    return;
  }
  if (!state.settings.driveRootFolderId) {
    if (!silent) toast('กรุณาใส่หรือสร้าง Drive Folder ID ก่อน');
    return;
  }
  try {
    isSyncing = true;
    syncStatus = { text: 'กำลังซิงก์ Drive Hub…', tone: 'info' };
    renderSyncStatusOnly();
    if (!drive.connected) await drive.authorize({ prompt: '' });
    if (uploadPendingFirst) await uploadPendingMoments({ silent: true });
    const shared = await drive.listSharedData();
    applyDriveData(shared);
    state.settings.lastDriveError = '';
    persist();
    syncStatus = { text: 'ซิงก์ Drive Hub สำเร็จ', tone: 'success' };
    if (!silent) toast(`ซิงก์แล้ว: ${shared.moments?.length || 0} โมเมนต์ / ${shared.members?.length || 0} สมาชิก`);
    render();
  } catch (error) {
    console.warn(error);
    state.settings.lastDriveError = error.message || String(error);
    syncStatus = { text: 'ซิงก์ไม่สำเร็จ แต่วิธี Local ยังใช้ได้', tone: 'error' };
    persist();
    if (!silent) toast(error.message || 'ซิงก์ Drive ไม่สำเร็จ');
  } finally {
    isSyncing = false;
  }
}

async function uploadPendingMoments(options = {}) {
  const { silent = false } = options;
  if (!state.settings.driveClientId || !state.settings.driveRootFolderId) {
    if (!silent) toast('ตั้งค่า Drive ก่อน');
    return 0;
  }
  if (!drive.connected) await drive.authorize({ prompt: '' });
  let uploaded = 0;

  for (const member of state.members.filter(m => m.storage !== 'drive')) {
    await uploadRecordIfConnected('members', member, { force: true }); uploaded += 1;
  }
  for (const moment of state.moments.filter(m => m.storage !== 'drive' || (m.media || []).some(media => media.pendingUpload))) {
    const result = await uploadMomentWithStoredMedia(moment);
    Object.assign(moment, result, { storage: 'drive' });
    uploaded += 1;
  }
  for (const reaction of state.reactions.filter(r => r.storage !== 'drive')) {
    await uploadRecordIfConnected('reactions', reaction, { force: true }); uploaded += 1;
  }
  for (const vote of state.votes.filter(v => v.storage !== 'drive')) {
    await uploadRecordIfConnected('votes', vote, { force: true }); uploaded += 1;
  }
  for (const quote of state.quotes.filter(q => q.storage !== 'drive')) {
    await uploadRecordIfConnected('quotes', quote, { force: true }); uploaded += 1;
  }
  for (const expense of state.expenses.filter(e => e.storage !== 'drive')) {
    await uploadRecordIfConnected('expenses', expense, { force: true }); uploaded += 1;
  }
  for (const quest of (state.questEvents || []).filter(q => q.storage !== 'drive')) {
    await uploadRecordIfConnected('quests', quest, { force: true }); uploaded += 1;
  }
  if (state.bingo && state.bingo.storage !== 'drive') {
    await uploadRecordIfConnected('games', state.bingo, { force: true }); uploaded += 1;
  }

  persist();
  if (!silent) toast(uploaded ? `ส่ง Pending เข้า Drive Hub ${uploaded} รายการแล้ว` : 'ไม่มี Pending ที่ต้องอัปโหลด');
  render();
  return uploaded;
}

async function uploadRecordIfConnected(collection, item, options = {}) {
  const force = Boolean(options.force);
  if ((!drive.connected || !state.settings.driveRootFolderId) && !force) return false;
  try {
    const now = new Date().toISOString();
    item.updatedAt ||= now;
    const file = await drive.uploadRecord(collection, item);
    item.storage = 'drive';
    item.syncedAt = now;
    item.driveJsonFileId = file.id;
    persist();
    return true;
  } catch (error) {
    console.warn('Upload pending kept local', collection, item, error);
    item.storage = 'local';
    return false;
  }
}

async function uploadMomentRecordIfConnected(moment) {
  if (!drive.connected || !state.settings.driveRootFolderId) return false;
  try {
    const result = (moment.media || []).length ? await uploadMomentWithStoredMedia(moment) : (await drive.uploadMoment(moment)).moment;
    Object.assign(moment, result, { storage: 'drive' });
    persist();
    return true;
  } catch (error) {
    console.warn('Moment upload pending kept local', moment, error);
    moment.storage = 'local';
    return false;
  }
}

function applyDriveData(shared = {}) {
  mergeRemote('members', shared.members || []);
  mergeRemote('moments', shared.moments || []);
  mergeRemote('reactions', shared.reactions || []);
  mergeRemote('votes', shared.votes || []);
  mergeRemote('quotes', shared.quotes || []);
  mergeRemote('expenses', shared.expenses || []);
  mergeQuestEvents(shared.quests || []);
  mergeGameRecords(shared.games || []);
}

function mergeRemote(key, remoteItems) {
  const map = new Map((state[key] || []).map(item => [item.id, item]));
  for (const remote of remoteItems || []) {
    if (!remote?.id) continue;
    const local = map.get(remote.id);
    if (!local) {
      map.set(remote.id, { ...remote, storage: 'drive' });
      continue;
    }
    const localTime = new Date(local.updatedAt || local.createdAt || 0).getTime();
    const remoteTime = new Date(remote.updatedAt || remote._driveModifiedTime || remote.createdAt || 0).getTime();
    if (remoteTime >= localTime || local.storage === 'drive') {
      const merged = { ...local, ...remote, storage: 'drive' };
      if (Array.isArray(merged.media) && Array.isArray(local.media)) {
        merged.media = merged.media.map((remoteMedia, index) => {
          const localMedia = findMatchingLocalMedia(remoteMedia, local.media, index);
          return localMedia ? {
            ...remoteMedia,
            localBlobId: remoteMedia.localBlobId || localMedia.localBlobId,
            localDataUrl: remoteMedia.localDataUrl || localMedia.localDataUrl
          } : remoteMedia;
        });
      }
      map.set(remote.id, merged);
    }
  }
  state[key] = [...map.values()].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
}


function findMatchingLocalMedia(remoteMedia, localMediaList, index) {
  return localMediaList.find(localMedia =>
    (remoteMedia.id && localMedia.id === remoteMedia.id) ||
    (remoteMedia.driveFileId && localMedia.driveFileId === remoteMedia.driveFileId) ||
    (remoteMedia.originalName && localMedia.name === remoteMedia.originalName) ||
    (remoteMedia.name && localMedia.name === remoteMedia.name)
  ) || localMediaList[index] || null;
}

function mergeQuestEvents(remoteItems = []) {
  state.questEvents ||= [];
  mergeRemote('questEvents', remoteItems);
  const latestByQuest = new Map();
  for (const event of state.questEvents || []) {
    if (!event.questId) continue;
    const old = latestByQuest.get(event.questId);
    const t = new Date(event.updatedAt || event.createdAt || 0).getTime();
    const oldT = old ? new Date(old.updatedAt || old.createdAt || 0).getTime() : -1;
    if (t >= oldT) latestByQuest.set(event.questId, event);
  }
  state.questsDone = {};
  for (const [questId, event] of latestByQuest.entries()) {
    if (event.done) state.questsDone[questId] = event.completedAt || event.createdAt || event.updatedAt;
  }
}

function mergeGameRecords(records = []) {
  const bingos = records.filter(r => r.type === 'bingo' && r.cells?.length);
  if (!bingos.length) return;
  bingos.sort((a, b) => new Date(a.updatedAt || a.createdAt || 0) - new Date(b.updatedAt || b.createdAt || 0));
  const latest = bingos.at(-1);
  const localTime = new Date(state.bingo?.updatedAt || state.bingo?.createdAt || 0).getTime();
  const remoteTime = new Date(latest.updatedAt || latest.createdAt || 0).getTime();
  if (!state.bingo || remoteTime >= localTime || state.bingo.storage === 'drive') {
    state.bingo = { ...latest, storage: 'drive' };
  }
}

function openReel() {
  reel.open = true;
  reel.index = 0;
  clearInterval(reel.timer);
  reel.timer = setInterval(() => moveReel(1), 5200);
  render();
}

function closeReel() {
  reel.open = false;
  clearInterval(reel.timer);
  reel.timer = null;
  render();
}

function moveReel(delta) {
  const items = buildReelItems();
  reel.index = (reel.index + delta + items.length) % items.length;
  render();
}

function exportRecapHtml() {
  const items = buildReelItems();
  const body = items.map(item => `
    <section class="slide">
      <div class="kicker">${escapeHtml(item.kicker || '')}</div>
      <h1>${escapeHtml(item.title || '')}</h1>
      <p>${escapeHtml(item.text || '')}</p>
    </section>`).join('\n');
  const html = `<!doctype html><html lang="th"><meta charset="utf-8"><title>${escapeHtml(state.trip.title)} Recap</title><style>body{margin:0;background:#071b19;color:#fff;font-family:system-ui}.slide{min-height:100vh;display:grid;place-content:center;padding:8vw;background:linear-gradient(135deg,#123d37,#0d2c28,#ef9b55)}h1{font-size:clamp(3rem,10vw,8rem);line-height:.9;margin:.2em 0}.kicker{color:#ffd28b;font-weight:800}p{font-size:1.4rem;max-width:800px;line-height:1.5}</style>${body}</html>`;
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `kannajaburi-recap-${new Date().toISOString().slice(0,10)}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}


async function downloadMomentMedia(momentId, mediaIndex = 0) {
  const moment = state.moments.find(item => item.id === momentId);
  const media = moment?.media?.[mediaIndex];
  if (!media) return toast('ไม่พบไฟล์นี้ในอัลบั้ม');
  try {
    const { url, revoke } = await mediaDownloadUrl(media);
    triggerDownload(url, safeFileName(media.originalName || media.name || `kannajaburi-media-${mediaIndex + 1}`));
    if (revoke) setTimeout(() => URL.revokeObjectURL(url), 2500);
    toast('เริ่มบันทึกไฟล์เต็มความละเอียดแล้ว');
  } catch (error) {
    console.warn(error);
    toast(error.message || 'บันทึกรูปไม่สำเร็จ');
  }
}

async function downloadMomentAlbum(momentId) {
  const moment = state.moments.find(item => item.id === momentId);
  const mediaList = moment?.media || [];
  if (!mediaList.length) return toast('โพสต์นี้ไม่มีอัลบั้ม');
  toast(`กำลังบันทึกอัลบั้ม ${mediaList.length} ไฟล์`);
  for (let i = 0; i < mediaList.length; i += 1) {
    // เว้นจังหวะเล็กน้อยเพื่อลดโอกาส browser บล็อก multiple downloads
    await new Promise(resolve => setTimeout(resolve, i ? 450 : 0));
    await downloadMomentMedia(momentId, i);
  }
}

async function mediaDownloadUrl(media) {
  if (media.localBlobId) {
    const blob = await getMediaBlob(media.localBlobId);
    if (blob) return { url: URL.createObjectURL(blob), revoke: true };
  }
  if (media.localDataUrl) return { url: media.localDataUrl, revoke: false };
  if (media.driveFileId) {
    if (!drive.connected) await drive.authorize({ prompt: '' });
    return { url: await drive.mediaUrl(media.driveFileId), revoke: false };
  }
  throw new Error('ไฟล์นี้ยังไม่อยู่ในเครื่องหรือยังไม่ได้ Sync Drive');
}

function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'kannajaburi-media';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function installApp() {
  if (!deferredInstallPrompt) return toast('ถ้าใช้ Chrome/Android ให้กดเมนู ⋮ แล้วเลือก Add to Home screen');
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
}

function resetLocal() {
  if (!confirm('ล้างข้อมูล Local ในเครื่องนี้? ข้อมูลบน Google Drive จะไม่ถูกลบ')) return;
  localStorage.removeItem('kannajaburi-trip-state-v1');
  state = loadState();
  toast('ล้างข้อมูล Local แล้ว');
  render();
}

async function hydrateMediaInDOM() {
  await hydrateLocalMediaInDOM();
  await hydrateDriveMediaInDOM();
}

async function hydrateLocalMediaInDOM() {
  const nodes = [...document.querySelectorAll('[data-local-blob-id]')];
  for (const node of nodes) {
    const blobId = node.dataset.localBlobId;
    const mime = node.dataset.localMime || '';
    try {
      const url = await mediaBlobUrl(blobId);
      if (!document.body.contains(node)) continue;
      if (url) {
        node.replaceWith(createMediaElement(url, mime, Boolean(node.closest('.reel'))));
      } else if (node.dataset.driveFallbackId && drive.connected) {
        const driveUrl = await drive.mediaUrl(node.dataset.driveFallbackId);
        node.replaceWith(createMediaElement(driveUrl, mime, Boolean(node.closest('.reel'))));
      }
    } catch (error) {
      if (node.dataset.driveFallbackId && drive.connected) {
        try {
          const driveUrl = await drive.mediaUrl(node.dataset.driveFallbackId);
          node.replaceWith(createMediaElement(driveUrl, mime, Boolean(node.closest('.reel'))));
          continue;
        } catch (fallbackError) {
          console.warn(fallbackError);
        }
      }
      node.textContent = 'โหลดไฟล์เต็มจากเครื่องไม่สำเร็จ';
      console.warn(error);
    }
  }
}

async function hydrateDriveMediaInDOM() {
  const nodes = [...document.querySelectorAll('[data-drive-file-id]')];
  if (!nodes.length || !drive.connected) return;
  for (const node of nodes) {
    const fileId = node.dataset.driveFileId;
    const mime = node.dataset.driveMime || '';
    try {
      const url = await drive.mediaUrl(fileId);
      if (!document.body.contains(node)) return;
      node.replaceWith(createMediaElement(url, mime, Boolean(node.closest('.reel'))));
    } catch (error) {
      node.textContent = 'โหลดรูปจาก Drive ไม่สำเร็จ';
      console.warn(error);
    }
  }
}

function createMediaElement(url, mime = '', reelMode = false) {
  if (mime.startsWith('video/')) {
    const video = document.createElement('video');
    video.src = url;
    video.controls = !reelMode;
    video.autoplay = reelMode;
    video.loop = reelMode;
    video.muted = true;
    video.playsInline = true;
    return video;
  }
  const img = document.createElement('img');
  img.src = url;
  img.alt = 'Drive media';
  img.loading = 'lazy';
  return img;
}

function memberSelect(name, selected) {
  const options = state.members.length ? state.members : [{ name: state.profile.name || 'แก๊งนี้' }];
  return `<select class="select" name="${escapeAttr(name)}">${options.map(m => `<option value="${escapeAttr(m.name)}" ${selected === m.name ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}</select>`;
}

function reactionSummary(reactions) {
  if (!reactions.length) return '';
  const counts = reactions.reduce((acc, r) => { acc[r.emoji] = (acc[r.emoji] || 0) + 1; return acc; }, {});
  return Object.entries(counts).map(([emoji, count]) => `${emoji} ${count}`).join(' · ');
}

function extractDriveFolderId(value) {
  if (!value) return '';
  const match = value.match(/folders\/([a-zA-Z0-9_-]+)/) || value.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : value.trim();
}

function safeFileName(name = 'file') {
  return name.replace(/[^a-zA-Z0-9ก-๙._-]+/g, '-').slice(0, 90) || 'file';
}

function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
function shuffle(list) { return [...list].sort(() => Math.random() - .5); }
function groupBy(list, fn) { return list.reduce((acc, item) => { const key = fn(item); (acc[key] ||= []).push(item); return acc; }, {}); }
function money(value) { return new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(Number(value || 0)); }

function hasBingo(cells) {
  const lines = [];
  for (let i = 0; i < 5; i += 1) {
    lines.push([0,1,2,3,4].map(x => i * 5 + x));
    lines.push([0,1,2,3,4].map(x => x * 5 + i));
  }
  lines.push([0,6,12,18,24], [4,8,12,16,20]);
  return lines.some(line => line.every(i => cells[i]?.marked));
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}
function escapeAttr(value = '') { return escapeHtml(value).replace(/'/g, '&#39;'); }
