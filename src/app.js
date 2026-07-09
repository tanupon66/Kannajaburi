import {
  loadState,
  saveState,
  exportState,
  importState,
  dataUrlToBlob,
  fileToOptimizedDataUrl,
  fileToDataUrl,
  formatThaiDate,
  initials,
  scoreFromState,
  uid
} from './state.js';
import { DriveSync } from './drive.js';
import { FirebaseHub } from './firebaseHub.js';
import { mediaId, saveMediaBlob, getMediaBlob, mediaBlobUrl } from './mediaStore.js';

let state = loadState();
const ACCOUNT_SESSION_KEY = 'kannajaburi-trip-active-account-v2';
const DEFAULT_ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_PASSWORD = '1234';
let currentPage = 'home';
let deferredInstallPrompt = null;
let currentGameDeck = 'most';
let reel = { open: false, index: 0, timer: null };
let storyViewer = { open: false, id: '', index: 0, timer: null };
let composer = { open: false, source: 'feed', caption: '', place: '', mood: 'ตำนาน', type: 'moment', gameCard: '', gps: null };
let syncTimer = null;
let isSyncing = false;
let syncStatus = { text: 'Local cache ready', tone: 'idle' };
let uploadUi = { active: false, text: '', tone: 'idle' };
let nextSyncAt = 0;

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

const firebase = new FirebaseHub({
  getState: () => state,
  saveState: persist,
  toast,
  onStatus: (text, tone = 'info') => {
    syncStatus = { text, tone };
    renderSyncStatusOnly();
  },
  onData: applyFirebaseData
});



function readAccountSession() {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNT_SESSION_KEY) || 'null');
  } catch (error) {
    console.warn('Cannot read account session:', error);
    return null;
  }
}

function saveAccountSession(account = {}) {
  try {
    if (!account.accountId && !account.id) return;
    const session = {
      accountId: account.accountId || account.id,
      name: account.name || '',
      username: account.username || '',
      role: account.role || 'สายคอนเทนต์',
      color: account.color || '#0f6b5e',
      avatarDataUrl: account.avatarDataUrl || '',
      avatarMimeType: account.avatarMimeType || '',
      avatarName: account.avatarName || '',
      isAdmin: Boolean(account.isAdmin),
      savedAt: new Date().toISOString()
    };
    localStorage.setItem(ACCOUNT_SESSION_KEY, JSON.stringify(session));
  } catch (error) {
    console.warn('Cannot save account session:', error);
  }
}


function clearAccountSession() {
  try { localStorage.removeItem(ACCOUNT_SESSION_KEY); } catch (error) { console.warn(error); }
}

function normalizeUsername(value = '') {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function normalizeName(value = '') {
  return String(value || '').trim();
}

async function sha256(text) {
  const input = new TextEncoder().encode(String(text));
  const hashBuffer = await crypto.subtle.digest('SHA-256', input);
  return [...new Uint8Array(hashBuffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function passwordHash(username, password) {
  return sha256(`${normalizeUsername(username)}::${String(password || '')}`);
}

function findAccountByUsername(username) {
  const key = normalizeUsername(username);
  return (state.accounts || []).find(account => isActiveItem(account) && normalizeUsername(account.username || account.name) === key);
}

function findAccountById(accountId) {
  return (state.accounts || []).find(account => isActiveItem(account) && (account.id === accountId || account.accountId === accountId));
}

function activeAccount() {
  const id = state.auth?.activeAccountId || state.profile?.accountId || '';
  return id ? findAccountById(id) : null;
}

function isAuthenticated() {
  return Boolean(activeAccount() && state.auth?.activeAccountId);
}

function applyAccountToProfile(account) {
  if (!account) return;
  state.auth ||= { activeAccountId: '', lastLoginAt: '', loginRequired: true };
  state.auth.activeAccountId = account.id || account.accountId;
  state.auth.lastLoginAt = new Date().toISOString();
  state.profile ||= {};
  state.profile.accountId = account.id || account.accountId;
  state.profile.name = account.name || account.username || 'เพื่อน';
  state.profile.username = account.username || '';
  state.profile.role = account.role || 'สายคอนเทนต์';
  state.profile.color = account.color || '#0f6b5e';
  state.profile.avatarDataUrl = account.avatarDataUrl || '';
  state.profile.avatarMimeType = account.avatarMimeType || '';
  state.profile.avatarName = account.avatarName || '';
  state.profile.isAdmin = Boolean(account.isAdmin);
  state.profile.createdAt ||= account.createdAt || new Date().toISOString();
  saveAccountSession(account);
}

function ensureMemberForAccount(account) {
  if (!account) return null;
  const now = new Date().toISOString();
  state.members ||= [];
  const member = {
    id: account.id,
    accountId: account.id,
    username: account.username || '',
    name: account.name || account.username || 'เพื่อน',
    role: account.role || 'สายคอนเทนต์',
    color: account.color || '#0f6b5e',
    avatarDataUrl: account.avatarDataUrl || '',
    avatarMimeType: account.avatarMimeType || '',
    avatarName: account.avatarName || '',
    isAdmin: Boolean(account.isAdmin),
    createdAt: account.createdAt || now,
    updatedAt: now,
    storage: 'local'
  };
  const index = state.members.findIndex(m => m.accountId === account.id || m.id === account.id || normalizeUsername(m.username || m.name) === normalizeUsername(account.username || account.name));
  if (index >= 0) state.members[index] = { ...state.members[index], ...member };
  else state.members.push(member);
  return member;
}

async function createAccount({ username, password, name, role = 'สายคอนเทนต์', color = '#0f6b5e', isAdmin = false, mustChangePassword = false }) {
  const user = normalizeUsername(username);
  const displayName = normalizeName(name) || user;
  if (!user) throw new Error('กรุณาใส่ username');
  if (String(password || '').length < 4) throw new Error('รหัสผ่านต้องมีอย่างน้อย 4 ตัว');
  if (findAccountByUsername(user)) throw new Error('username นี้ถูกใช้แล้ว');
  const now = new Date().toISOString();
  const account = {
    id: uid('acct'),
    accountId: '',
    username: user,
    name: displayName,
    role,
    color,
    isAdmin: Boolean(isAdmin),
    passwordHash: await passwordHash(user, password),
    mustChangePassword: Boolean(mustChangePassword),
    createdAt: now,
    updatedAt: now,
    storage: 'local'
  };
  account.accountId = account.id;
  state.accounts ||= [];
  state.accounts.push(account);
  const member = ensureMemberForAccount(account);
  persist();
  Promise.all([uploadRecordIfConnected('accounts', account), member ? uploadRecordIfConnected('members', member) : Promise.resolve()]).catch(console.warn);
  return account;
}

async function verifyAccountPassword(account, password) {
  if (!account?.passwordHash) return false;
  return account.passwordHash === await passwordHash(account.username || account.name, password);
}

function logoutAccount() {
  state.auth ||= {};
  state.auth.activeAccountId = '';
  state.profile = { accountId: '', name: '', role: 'สายคอนเทนต์', color: '#0f6b5e', avatarDataUrl: '', avatarMimeType: '', avatarName: '', isAdmin: false, pinHint: '', createdAt: '' };
  clearAccountSession();
  persist();
  toast('ออกจากระบบแล้ว');
  render();
}

function restoreProfileFromSession() {
  state.auth ||= { activeAccountId: '', lastLoginAt: '', loginRequired: true };
  state.profile ||= {};
  const session = readAccountSession();
  const sessionId = session?.accountId || '';
  const currentId = state.auth.activeAccountId || state.profile.accountId || sessionId;
  const source = currentId ? (findAccountById(currentId) || (state.members || []).find(m => m.accountId === currentId || m.id === currentId) || session) : null;
  if (source?.accountId || source?.id) {
    const accountId = source.accountId || source.id;
    state.auth.activeAccountId = accountId;
    state.profile.accountId = accountId;
    state.profile.name = source.name || state.profile.name || '';
    state.profile.username = source.username || state.profile.username || '';
    state.profile.role = source.role || state.profile.role || 'สายคอนเทนต์';
    state.profile.color = source.color || state.profile.color || '#0f6b5e';
    state.profile.avatarDataUrl = source.avatarDataUrl || state.profile.avatarDataUrl || '';
    state.profile.avatarMimeType = source.avatarMimeType || state.profile.avatarMimeType || '';
    state.profile.avatarName = source.avatarName || state.profile.avatarName || '';
    state.profile.isAdmin = Boolean(source.isAdmin);
    state.profile.createdAt ||= source.createdAt || session?.savedAt || new Date().toISOString();
    saveAccountSession({ ...source, id: accountId, accountId });
  } else {
    state.auth.activeAccountId = '';
  }
  state.accountModalOpen = false;
  persist();
}

function currentAccountId() {
  return state.auth?.activeAccountId || state.profile?.accountId || '';
}

function currentUserName() {
  const account = activeAccount();
  return state.profile.name || account?.name || state.members[0]?.name || 'เพื่อน';
}

function currentUserRoleLabel() {
  const account = activeAccount();
  return (state.profile.isAdmin || account?.isAdmin) ? 'Admin' : 'Member';
}

function currentUserBadge() {
  const account = activeAccount();
  return (state.profile.isAdmin || account?.isAdmin) ? '👑 Admin' : '🙋 Member';
}

function isAdminAccount() {
  const account = activeAccount();
  return Boolean(state.profile.isAdmin || account?.isAdmin);
}

function requireAdmin(message = 'เฉพาะ Admin เท่านั้นที่จัดการส่วนนี้ได้') {
  if (isAdminAccount()) return true;
  toast(message);
  return false;
}

function accountForDisplay({ accountId = '', name = '' } = {}) {
  if (accountId) {
    const acc = findAccountById(accountId);
    if (acc) return acc;
    const member = (state.members || []).find(m => isActiveItem(m) && (m.accountId === accountId || m.id === accountId));
    if (member) return member;
  }
  if (name) {
    const member = (state.members || []).find(m => isActiveItem(m) && m.name === name);
    if (member) return member;
    const acc = (state.accounts || []).find(a => isActiveItem(a) && (a.name === name || a.username === normalizeUsername(name)));
    if (acc) return acc;
  }
  return null;
}

function renderAvatar({ accountId = '', name = '', color = '', className = 'avatar', fallback = '?' } = {}) {
  const person = accountForDisplay({ accountId, name }) || {};
  const display = name || person.name || person.username || fallback;
  const bg = color || person.color || '#0f6b5e';
  const avatar = person.avatarDataUrl || (person.id === state.profile.accountId ? state.profile.avatarDataUrl : '') || '';
  return `<span class="${escapeAttr(className)}" style="background:${escapeAttr(bg)}">${avatar ? `<img src="${escapeAttr(avatar)}" alt="${escapeAttr(display)}" />` : escapeHtml(initials(display))}</span>`;
}

function currentAvatar(className = 'avatar') {
  return renderAvatar({ accountId: currentAccountId(), name: currentUserName(), color: state.profile.color, className });
}

function isActiveItem(item) {
  return item && item.deleted !== true;
}

function activeList(key) {
  return (state[key] || []).filter(isActiveItem);
}

function currentActorMeta() {
  return {
    author: currentUserName(),
    accountId: currentAccountId() || uid('guest')
  };
}

function canManageItem(item = {}) {
  const accountId = currentAccountId();
  const name = currentUserName();
  return Boolean(
    isAdminAccount() ||
    item.accountId === accountId ||
    item.authorId === accountId ||
    item.createdById === accountId ||
    item.deletedById === accountId ||
    item.author === name ||
    item.createdBy === name
  );
}

function liveStorageLabel(item = {}) {
  if (item.deleted) return 'Deleted';
  return item.storage === 'firebase' ? 'Live' : item.storage === 'drive' ? 'Drive' : 'Local';
}

function ensureCollection(key) {
  if (!Array.isArray(state[key])) state[key] = [];
  return state[key];
}

function ensureMomentActive(momentId) {
  return activeList('moments').some(item => item.id === momentId);
}

function ensureProfileAccount() {
  state.accounts ||= [];
  let account = activeAccount();
  const now = new Date().toISOString();
  if (!account) {
    const username = normalizeUsername(state.profile.username || state.profile.name || `user${Date.now().toString(36)}`);
    account = {
      id: state.profile.accountId || uid('acct'),
      accountId: state.profile.accountId || '',
      username,
      name: state.profile.name || username,
      role: state.profile.role || 'สายคอนเทนต์',
      color: state.profile.color || '#0f6b5e',
      avatarDataUrl: state.profile.avatarDataUrl || '',
      avatarMimeType: state.profile.avatarMimeType || '',
      avatarName: state.profile.avatarName || '',
      isAdmin: Boolean(state.profile.isAdmin),
      createdAt: state.profile.createdAt || now,
      updatedAt: now,
      storage: 'local'
    };
    account.accountId = account.id;
    state.accounts.push(account);
    applyAccountToProfile(account);
  } else {
    account = {
      ...account,
      name: state.profile.name || account.name,
      role: state.profile.role || account.role || 'สายคอนเทนต์',
      color: state.profile.color || account.color || '#0f6b5e',
      avatarDataUrl: state.profile.avatarDataUrl || account.avatarDataUrl || '',
      avatarMimeType: state.profile.avatarMimeType || account.avatarMimeType || '',
      avatarName: state.profile.avatarName || account.avatarName || '',
      isAdmin: Boolean(state.profile.isAdmin),
      updatedAt: now,
      storage: account.storage === 'firebase' ? 'local' : account.storage || 'local'
    };
    const index = state.accounts.findIndex(a => a.id === account.id);
    if (index >= 0) state.accounts[index] = account;
  }
  return account;
}

function activeReactionFor(momentId) {
  const accountId = currentAccountId();
  return uniqueActiveReactions((state.reactions || []).filter(r => r.momentId === momentId))
    .find(r => r.accountId === accountId || (!r.accountId && r.author === currentUserName()));
}

function applyAdminDriveSettings(record) {
  if (!record) return false;
  let changed = false;
  const directFields = [
    'driveClientId', 'driveRootFolderId', 'driveRootFolderName',
    'firebaseTripId', 'firebaseApiKey', 'firebaseAuthDomain', 'firebaseProjectId',
    'firebaseStorageBucket', 'firebaseMessagingSenderId', 'firebaseAppId'
  ];
  for (const key of directFields) {
    if (record[key] !== undefined && record[key] !== '' && state.settings[key] !== record[key]) {
      state.settings[key] = record[key];
      changed = true;
    }
  }
  if (record.firebaseEnabled !== undefined && state.settings.firebaseEnabled !== Boolean(record.firebaseEnabled)) {
    state.settings.firebaseEnabled = Boolean(record.firebaseEnabled);
    changed = true;
  }
  if (record.driveManagedByAdmin !== undefined) state.settings.driveManagedByAdmin = Boolean(record.driveManagedByAdmin);
  if (record.adminDriveOwner) state.settings.adminDriveOwner = record.adminDriveOwner;
  if (record.updatedAt) state.settings.adminDriveSharedAt = record.updatedAt;
  if (changed) {
    state.settings.driveChildren = {};
    state.settings.collectionSyncAt = {};
    state.settings.syncMode = state.settings.firebaseEnabled ? 'firebase-first' : 'drive-first';
  }
  return changed;
}

async function publishAdminDriveSettings() {
  if (!requireAdmin('เฉพาะ Admin เท่านั้นที่เผยแพร่ Hub ให้สมาชิกได้')) return;
  if (!state.settings.driveClientId || !state.settings.driveRootFolderId) return toast('ใส่ Google OAuth Client ID และ Drive Folder ID ก่อน');
  const now = new Date().toISOString();
  const record = {
    id: 'admin-drive-hub',
    driveClientId: state.settings.driveClientId,
    driveRootFolderId: state.settings.driveRootFolderId,
    driveRootFolderName: state.settings.driveRootFolderName,
    firebaseEnabled: Boolean(state.settings.firebaseEnabled),
    firebaseTripId: state.settings.firebaseTripId || 'kannajaburi-trip',
    firebaseApiKey: state.settings.firebaseApiKey || '',
    firebaseAuthDomain: state.settings.firebaseAuthDomain || '',
    firebaseProjectId: state.settings.firebaseProjectId || '',
    firebaseStorageBucket: state.settings.firebaseStorageBucket || '',
    firebaseMessagingSenderId: state.settings.firebaseMessagingSenderId || '',
    firebaseAppId: state.settings.firebaseAppId || '',
    driveManagedByAdmin: true,
    adminDriveOwner: currentUserName(),
    createdAt: state.settings.adminDriveSharedAt || now,
    updatedAt: now,
    storage: 'local'
  };
  state.tripSettings ||= [];
  const index = state.tripSettings.findIndex(x => x.id === record.id);
  if (index >= 0) state.tripSettings[index] = { ...state.tripSettings[index], ...record };
  else state.tripSettings.push(record);
  state.settings.adminDriveOwner = record.adminDriveOwner;
  state.settings.adminDriveSharedAt = now;
  persist();
  await uploadRecordIfConnected('tripSettings', record);
  toast('เผยแพร่ Firebase + Drive Hub ให้สมาชิกแล้ว');
  render();
}


function invitePayload() {
  return {
    v: 1,
    app: 'kannajaburi-trip',
    firebaseEnabled: Boolean(state.settings.firebaseEnabled),
    firebaseTripId: state.settings.firebaseTripId || 'kannajaburi-trip',
    firebaseApiKey: state.settings.firebaseApiKey || '',
    firebaseAuthDomain: state.settings.firebaseAuthDomain || '',
    firebaseProjectId: state.settings.firebaseProjectId || '',
    firebaseStorageBucket: state.settings.firebaseStorageBucket || '',
    firebaseMessagingSenderId: state.settings.firebaseMessagingSenderId || '',
    firebaseAppId: state.settings.firebaseAppId || '',
    driveClientId: state.settings.driveClientId || '',
    driveRootFolderId: state.settings.driveRootFolderId || '',
    driveRootFolderName: state.settings.driveRootFolderName || 'กาญนะจ๊ะบุรีทริป - Shared Memories',
    tripTitle: state.trip?.title || 'กาญนะจ๊ะบุรีทริป',
    destination: state.trip?.destination || '',
    createdAt: new Date().toISOString()
  };
}

function encodeInvite(data) {
  try {
    const json = JSON.stringify(data);
    const b64 = btoa(unescape(encodeURIComponent(json)));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  } catch (error) {
    console.warn('Cannot encode invite:', error);
    return '';
  }
}

function decodeInvite(code = '') {
  try {
    const normalized = String(code).replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    return JSON.parse(decodeURIComponent(escape(atob(padded))));
  } catch (error) {
    console.warn('Cannot decode invite:', error);
    return null;
  }
}

function buildInviteLink() {
  const code = encodeInvite(invitePayload());
  const base = `${location.origin}${location.pathname}`;
  return code ? `${base}?invite=${code}` : base;
}

function applyInviteFromUrl() {
  const searchParams = new URLSearchParams(location.search || '');
  const hashValue = (location.hash || '').replace(/^#/, '');
  const hashParams = new URLSearchParams(hashValue.includes('=') ? hashValue : '');
  const code = searchParams.get('invite') || hashParams.get('invite') || '';
  if (!code) return false;
  const data = decodeInvite(code);
  if (!data || data.app !== 'kannajaburi-trip') return false;
  const fields = [
    'firebaseEnabled', 'firebaseTripId', 'firebaseApiKey', 'firebaseAuthDomain', 'firebaseProjectId',
    'firebaseStorageBucket', 'firebaseMessagingSenderId', 'firebaseAppId', 'driveClientId',
    'driveRootFolderId', 'driveRootFolderName'
  ];
  for (const key of fields) {
    if (data[key] !== undefined && data[key] !== '') state.settings[key] = data[key];
  }
  state.settings.driveManagedByAdmin = true;
  state.settings.autoSyncOnStart = true;
  state.settings.liveSyncEnabled = true;
  state.settings.syncMode = state.settings.firebaseEnabled ? 'firebase-first' : 'drive-first';
  if (data.tripTitle) state.trip.title = data.tripTitle;
  if (data.destination) state.trip.destination = data.destination;
  persist();
  try { window.history.replaceState({}, document.title, `${location.origin}${location.pathname}`); } catch (error) { console.warn(error); }
  syncStatus = { text: 'รับลิงก์เชิญจาก Admin แล้ว กำลังเชื่อมต่ออัตโนมัติ…', tone: 'success' };
  return true;
}

async function copyAdminInviteLink() {
  if (!requireAdmin('เฉพาะ Admin เท่านั้นที่สร้างลิงก์เชิญได้')) return;
  if (!state.settings.firebaseEnabled || !state.settings.firebaseProjectId || !state.settings.firebaseApiKey || !state.settings.firebaseAppId) {
    return toast('ตั้งค่า Firebase ให้ครบก่อนสร้างลิงก์เชิญสมาชิก');
  }
  const link = buildInviteLink();
  try {
    await navigator.clipboard.writeText(link);
    toast('คัดลอกลิงก์เชิญสมาชิกแล้ว');
  } catch (error) {
    prompt('คัดลอกลิงก์นี้ให้สมาชิก', link);
  }
}

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

const PACKING_ITEMS = ['เสื้อผ้า', 'ผ้าเช็ดตัว', 'ยากันยุง', 'Power bank', 'ถุงกันน้ำ', 'รองเท้าแตะ/ลุยน้ำ', 'ยาประจำตัว', 'ไฟฉาย', 'สายชาร์จ', 'ลำโพงพกพา'];


init();

function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(console.warn);
  }
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
  });
  document.addEventListener('click', onClick, true);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('change', onChange);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && drive.connected && state.settings.liveSyncEnabled) syncDrive({ silent: true }).catch(console.warn);
  });
  applyInviteFromUrl();
  restoreProfileFromSession();
  state.accountModalOpen = false;
  render();
  setTimeout(autoConnectFirebaseOnStart, 350);
  setTimeout(autoConnectDriveOnStart, 800);
}


function persist() {
  saveState(state);
}

async function autoConnectFirebaseOnStart() {
  if (!state.settings.firebaseEnabled) return;
  try {
    syncStatus = { text: 'กำลังเปิด Firebase Live Feed…', tone: 'info' };
    renderSyncStatusOnly();
    await firebase.connect({ listen: true });
    await uploadPendingSocialRecords({ silent: true });
  } catch (error) {
    console.warn('Firebase auto connect skipped:', error);
    state.settings.lastFirebaseError = error.message || String(error);
    syncStatus = { text: 'แตะ Connect Firebase เพื่อลองใหม่', tone: 'idle' };
    persist();
    renderSyncStatusOnly();
  }
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
  const interval = Math.max(15, Number(state.settings.syncIntervalSec || 20)) * 1000;
  nextSyncAt = Date.now() + interval;
  syncTimer = setInterval(() => {
    if (!document.hidden && drive.connected && !isSyncing) {
      nextSyncAt = Date.now() + interval;
      syncDrive({ silent: true, uploadPendingFirst: true }).catch(console.warn);
    }
  }, interval);
}

function stopSyncLoop() {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = null;
}

function syncSummary() {
  const last = state.settings.lastSyncAt ? `Drive sync ล่าสุด ${formatThaiDate(state.settings.lastSyncAt)}` : 'Drive ยังไม่เคย sync';
  const pending = countPendingRecords();
  const mode = state.settings.firebaseEnabled ? 'Firebase Live Feed + Drive Media' : state.settings.syncMode === 'drive-first' ? 'Drive Hub' : 'Local';
  const live = firebase.connected ? ' · realtime on' : state.settings.liveSyncEnabled ? ` · drive poll ${Number(state.settings.syncIntervalSec || 20)}s` : '';
  const statusText = syncStatus?.text ? ` · ${syncStatus.text}` : '';
  return `${mode}${live} · ${last} · pending ${pending}${statusText}`;
}

function renderSyncStatusOnly() {
  const pill = document.querySelector('#syncPill span');
  if (pill) pill.textContent = syncSummary();
}

function countPendingRecords() {
  let count = 0;
  for (const key of ['accounts', 'tripSettings', 'members', 'moments', 'reactions', 'comments', 'votes', 'quotes', 'expenses']) {
    count += (state[key] || []).filter(item => !['drive','firebase'].includes(item.storage)).length;
  }
  count += (state.moments || []).filter(item => (item.media || []).some(media => media.pendingUpload)).length;
  count += (state.questEvents || []).filter(item => !['drive','firebase'].includes(item.storage)).length;
  if (state.bingo && !['drive','firebase'].includes(state.bingo.storage)) count += 1;
  if (state.secretBuddy && !['drive','firebase'].includes(state.secretBuddy.storage)) count += 1;
  if (state.checklist?.updatedAt && !['drive','firebase'].includes(state.checklist.storage)) count += 1;
  return count;
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

function render() {
  if (!isAuthenticated()) {
    app.innerHTML = renderLoginScreen();
    return;
  }
  const title = pageTitle(currentPage);
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-badge">📖</div>
          <h1>${escapeHtml(state.trip.title || state.appName)}</h1>
          <p>${escapeHtml(state.trip.subtitle || 'สมุดความทรงจำประจำแก๊ง')}</p><div class="account-mini"><span>${currentUserBadge()}</span><b>${escapeHtml(currentUserName())}</b></div>
        </div>
        <nav class="nav">${renderNav()}</nav>
        <div class="sync-pill ${drive.connected ? 'connected' : ''}" id="syncPill">
          <strong>${firebase.connected ? '🟢 Firebase Live Feed' : drive.connected ? '🟢 Drive Media Connected' : '⚪ รอเชื่อมต่อ Hub'}</strong>
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
            <button class="btn ghost" data-action="open-account">${currentUserBadge()}</button><button class="btn accent" data-action="quick-moment">＋ เพิ่มโมเมนต์</button>
            <button class="btn" data-action="sync-drive">↻ อัปเดตข้อมูล</button>
          </div>
        </div>
        ${renderPage()}
      </main>
      <nav class="mobile-nav">${renderMobileNav()}</nav>
    </div>
    ${reel.open ? renderReel() : ''}
    ${storyViewer.open ? renderStoryViewer() : ''}
    ${composer.open ? renderComposerModal() : ''}
    ${state.accountModalOpen ? renderAccountModal() : ''}
  `;
  hydrateMediaInDOM();
}


function renderLoginScreen() {
  const hasAdmin = (state.accounts || []).some(account => isActiveItem(account) && account.isAdmin);
  const users = activeList('accounts').filter(account => !account.isAdmin).slice(0, 6);
  return `
    <main class="login-page">
      <section class="login-hero card">
        <div class="app-logo">📖</div>
        <h1>กาญนะจ๊ะบุรีทริป</h1>
        <p>เข้าสู่ระบบเพื่อแชร์โมเมนต์ เช็กอิน เล่นเกม และเก็บความทรงจำร่วมกับเพื่อน</p>
      </section>
      <section class="login-grid">
        <form class="login-card card" data-form="admin-login">
          <div class="login-card-head"><span>👑</span><div><h2>Admin</h2><p>${hasAdmin ? 'เข้าสู่ระบบผู้ดูแล' : 'ครั้งแรกใช้รหัส 1234'}</p></div></div>
          <div class="field"><label>Username</label><input class="input" name="username" value="admin" autocomplete="username" required /></div>
          <div class="field"><label>Password</label><input class="input" name="password" type="password" inputmode="numeric" autocomplete="current-password" placeholder="รหัสผ่าน" required /></div>
          <button class="btn primary full" type="submit">เข้าสู่ระบบ Admin</button>
        </form>
        <form class="login-card card" data-form="member-login">
          <div class="login-card-head"><span>🙋</span><div><h2>Member</h2><p>ถ้ายังไม่มีบัญชี ระบบจะสร้างให้จาก username/password นี้</p></div></div>
          <div class="field"><label>Username</label><input class="input" name="username" autocomplete="username" placeholder="เช่น ton" required /></div>
          <div class="field"><label>Password</label><input class="input" name="password" type="password" autocomplete="current-password" placeholder="อย่างน้อย 4 ตัว" required /></div>
          <div class="grid two compact-fields">
            <div class="field"><label>ชื่อที่แสดง</label><input class="input" name="name" placeholder="เช่น ต้น" /></div>
            <div class="field"><label>คาแรกเตอร์</label><select class="select" name="role">${['สายคอนเทนต์','สายฮา','สายกิน','สายหลับ','สายเปย์','สายไกด์','สายถ่ายรูป','สายดูแลเพื่อน'].map(x => `<option>${x}</option>`).join('')}</select></div>
          </div>
          <button class="btn accent full" type="submit">เข้าใช้งาน / สร้างบัญชี</button>
          ${users.length ? `<div class="known-users">${users.map(u => `<span>${escapeHtml(u.name || u.username)}</span>`).join('')}</div>` : ''}
        </form>
      </section>
    </main>
  `;
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
    home: { icon: '🏕️', name: 'Trip Home', desc: 'ภาพรวมทริป แผนวันนี้ เช็กอิน สตอรี่ และความทรงจำล่าสุด' },
    feed: { icon: '📸', name: 'Memory Feed', desc: 'โพสต์รูป เช็กอิน คอมเมนต์ และแชร์โมเมนต์ร่วมกัน' },
    quest: { icon: '🧭', name: 'ภารกิจแก๊ง', desc: 'ทำเควสต์ ถ่ายคอนเทนต์ เล่นน้ำแบบปลอดภัย และเก็บ XP' },
    games: { icon: '🎲', name: 'เกมบนแพ', desc: 'Most Likely, Truth or Mission, Trip Bingo, Secret Buddy และ Caption Battle' },
    recap: { icon: '🎞️', name: 'สมุดความทรงจำ', desc: 'นำเสนอโมเมนต์รวมแบบ Reel/สไลด์ และสร้าง Recap หลังจบทริป' },
    tools: { icon: '🧰', name: 'ตั้งค่าและเครื่องมือ', desc: 'บัญชี สมาชิก ค่าใช้จ่าย Checklist และ Backup' }
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
  const moments = activeList('moments').length;
  const score = scoreFromState(state);
  const topQuests = QUESTS.filter(q => !state.questsDone[q.id]).slice(0, 3);
  const latest = activeList('moments').sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, 3);
  const destination = state.trip.destination || 'ทริปของเรา';
  return `
    <section class="app-home">
      <div class="trip-hero card">
        <div class="trip-hero-bg"></div>
        <div class="trip-hero-content">
          <div class="trip-kicker">${escapeHtml(destination)}</div>
          <h2>${escapeHtml(state.trip.title || state.appName || 'Trip Memory')}</h2>
          <p>${escapeHtml(state.trip.subtitle || 'แชร์รูป เช็กอิน เล่นเกม และเก็บความทรงจำร่วมกัน')}</p>
          <div class="hero-stats">
            <span class="stat-chip">📅 ${escapeHtml(state.trip.day || 'วันนี้')}</span>
            <span class="stat-chip">✨ ${escapeHtml(state.trip.mood || 'พร้อมสร้างโมเมนต์')}</span>
            <span class="stat-chip">🔥 XP ${score}</span>
          </div>
          <div class="action-row">
            <button class="btn accent" data-action="open-composer">＋ เพิ่มโมเมนต์</button>
            <button class="btn primary" data-action="quick-story">◎ เพิ่ม Story</button>
            <button class="btn" data-action="open-reel">▶️ Memory Reel</button>
          </div>
        </div>
      </div>

      <div class="grid four home-kpis">
        <div class="card kpi"><b>${activeList('members').length}</b><span>สมาชิก</span></div>
        <div class="card kpi"><b>${moments}</b><span>โพสต์</span></div>
        <div class="card kpi"><b>${done}/${QUESTS.length}</b><span>Quest</span></div>
        <div class="card kpi"><b>${activeList('votes').length}</b><span>Vote</span></div>
      </div>

      <div class="grid two">
        <div class="card pad stack trip-plan-card">
          <div class="spread"><h3>แผนวันนี้</h3><button class="btn ghost" data-nav="tools">แก้แผน</button></div>
          <div class="timeline-card">
            <span>📍</span>
            <div><b>${escapeHtml(state.trip.day || 'ระบุช่วงทริป')}</b><p>${escapeHtml(state.trip.nextPlan || 'เพิ่มแผนวันนี้ เช่น จุดนัดพบ / เช็กอิน / เกมตอนกลางคืน')}</p></div>
          </div>
          <div class="quick-grid">
            <button class="quick-tile" data-action="quick-checkin">📍<b>เช็กอิน</b><span>บันทึกสถานที่ + GPS</span></button>
            <button class="quick-tile" data-action="quick-story">◎<b>Story</b><span>แชร์โมเมนต์สั้น ๆ</span></button>
            <button class="quick-tile" data-action="start-game">🎲<b>Games</b><span>เล่นกับเพื่อน</span></button>
            <button class="quick-tile" data-action="random-quest">🧭<b>Quest</b><span>สุ่มภารกิจ</span></button>
          </div>
        </div>
        <div class="card pad stack">
          <div class="spread"><h3>โมเมนต์ล่าสุด</h3><button class="btn ghost" data-nav="feed">ไป Feed</button></div>
          ${latest.map(m => `<div class="mini-moment"><div>${renderStoryThumb(m)}</div><span><b>${escapeHtml(m.caption || m.place || 'โมเมนต์ใหม่')}</b><small>${escapeHtml(m.author || 'เพื่อน')} · ${formatThaiDate(m.createdAt)}</small></span></div>`).join('') || '<div class="empty">ยังไม่มีโมเมนต์ เริ่มโพสต์แรกของทริปได้เลย</div>'}
        </div>
      </div>

      <div class="grid two">
        <div class="card pad stack">
          <div class="spread"><h3>ภารกิจแนะนำ</h3><button class="btn ghost" data-nav="quest">ดูทั้งหมด</button></div>
          ${topQuests.map(renderQuestCard).join('') || '<div class="empty">ทำเควสต์ครบแล้ว เก่งมาก 🎉</div>'}
        </div>
        <div class="card pad stack">
          <div class="spread"><h3>สมาชิกทริป</h3><button class="btn ghost" data-nav="tools">จัดการ</button></div>
          ${renderMembers()}
        </div>
      </div>
    </section>
  `;
}

function renderMembers() {
  const members = activeList('members');
  if (!members.length) return '<div class="empty">ยังไม่มีสมาชิก เพิ่มชื่อเพื่อนก่อนเริ่มเล่นเกม</div>';
  return `<div class="member-list">${members.map(m => `
    <span class="member-chip">
      ${renderAvatar({ accountId: m.accountId || m.id, name: m.name, color: m.color })}
      <span>${escapeHtml(m.name)}</span>
      ${canManageItem(m) ? `<button class="mini-link danger" data-action="delete-member" data-id="${escapeAttr(m.id)}">ลบ</button>` : ''}
    </span>
  `).join('')}</div>`;
}

function renderFeed() {
  const sorted = activeList('moments').sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const storyMoments = sorted.filter(m => (m.type === 'story' || m.story === true || m.source === 'story') && (m.media || []).length);
  const recentStoryFallback = sorted.filter(m => (m.media || []).length && m.type !== 'story').slice(0, Math.max(0, 10 - storyMoments.length));
  const stories = [...storyMoments, ...recentStoryFallback].slice(0, 14);
  const feedPosts = sorted.filter(m => m.type !== 'story');
  return `
    <section class="ig-screen">
      <header class="ig-topbar">
        <div class="ig-wordmark">
          <span class="ig-logo-dot"></span>
          <b>${escapeHtml(state.trip.title || state.appName || 'Tripgram')}</b>
        </div>
        <div class="ig-top-actions">
          <button class="ig-icon-action" data-action="quick-story" aria-label="เพิ่ม Story">◎</button>
          <button class="ig-icon-action" data-action="open-composer" aria-label="เพิ่มโพสต์">＋</button>
          <button class="ig-icon-action" data-action="open-account" aria-label="บัญชีของฉัน">${currentAvatar('avatar mini-avatar')}</button>
        </div>
      </header>

      <div class="ig-stories-strip" aria-label="Stories">
        <button class="ig-story-bubble add" data-action="quick-story">
          <span class="story-avatar-wrap">${currentAvatar('avatar story-avatar')}<i>＋</i></span>
          <b>Your story</b>
        </button>
        ${stories.map((m, index) => `
          <button class="ig-story-bubble" data-action="open-story" data-id="${escapeAttr(m.id)}" data-index="${index}">
            <span class="story-avatar-wrap">${renderStoryThumb(m)}</span>
            <b>${escapeHtml((m.author || 'เพื่อน').slice(0, 12))}</b>
          </button>
        `).join('') || `<div class="ig-story-bubble muted"><span class="story-avatar-wrap">📸</span><b>ยังไม่มี</b></div>`}
      </div>

      <div class="ig-compose-strip">
        <button data-action="open-composer">＋ เพิ่มโพสต์</button>
        <button data-action="quick-checkin">📍 เช็กอิน</button>
        <button data-action="quick-story">◎ Story</button>
      </div>

      <div class="ig-feed-list">
        ${uploadUi.active ? renderUploadNotice() : ''}
        ${feedPosts.map(renderMomentCard).join('') || '<div class="card empty ig-empty-feed">ยังไม่มีโพสต์ กด “เพิ่มโพสต์” เพื่อเปิดอัลบั้มแรกของทริป 📸</div>'}
      </div>
    </section>
  `;
}

function renderUploadNotice() {
  const tone = uploadUi.tone || 'info';
  return `
    <div class="upload-live-card ${escapeAttr(tone)}">
      <span class="upload-spinner" aria-hidden="true"></span>
      <div><b>กำลังจัดการโพสต์</b><p>${escapeHtml(uploadUi.text || 'กำลังอัปโหลดไฟล์เต็มความละเอียด…')}</p></div>
    </div>
  `;
}

function renderStoryThumb(moment) {
  const media = (moment.media || [])[0];
  if (!media) return renderAvatar({ accountId: moment.authorId, name: moment.author, className: 'avatar story-avatar' });
  if (media.localDataUrl && media.mimeType?.startsWith('image/')) return `<img src="${escapeAttr(media.localDataUrl)}" alt="story" />`;
  if (media.thumbnailLink) return `<img src="${escapeAttr(media.thumbnailLink)}" alt="story" />`;
  if (media.mimeType?.startsWith('video/')) return '<span>▶️</span>';
  return '<span>📸</span>';
}

function renderMomentCard(moment) {
  const mediaList = Array.isArray(moment.media) ? moment.media : [];
  const typeIcon = moment.type === 'story' ? '◎' : moment.type === 'checkin' ? '📍' : moment.type === 'quote' ? '💬' : moment.type === 'game' ? '🎲' : moment.type === 'quest' ? '🧭' : moment.type === 'secret' ? '🕵️' : moment.type === 'vote' ? '🏆' : '📸';
  const mediaHtml = renderAlbumMedia(mediaList, moment.id);
  const reactions = uniqueActiveReactions((state.reactions || []).filter(r => r.momentId === moment.id));
  const reactionText = reactionSummary(reactions);
  const comments = (state.comments || []).filter(c => c.momentId === moment.id && !c.deleted);
  const albumText = mediaList.length ? `${mediaList.length} ไฟล์ · Full resolution` : 'โพสต์ข้อความ';
  const mediaPending = mediaList.some(media => media.pendingUpload || (!media.driveFileId && !media.webViewLink && media.localBlobId));
  const uploadState = moment.uploadState || (mediaPending ? 'pending' : moment.storage === 'firebase' || moment.storage === 'drive' ? 'synced' : 'local');
  const canDelete = canManageItem(moment);
  return `
    <article class="ig-post" data-post-id="${escapeAttr(moment.id)}">
      <header class="ig-post-head">
        <div class="ig-post-user">
          ${renderAvatar({ accountId: moment.authorId, name: moment.author, color: memberColor(moment.author) })}
          <div>
            <b>${escapeHtml(moment.author || 'ไม่ระบุชื่อ')}</b>
            <span>${typeIcon} ${escapeHtml(moment.place || moment.mood || state.trip.destination || 'Trip moment')} · ${formatThaiDate(moment.createdAt)}</span>
          </div>
        </div>
        <div class="ig-post-menu">
          <span class="ig-storage-dot" title="${escapeAttr(liveStorageLabel(moment))}"></span>
          ${canDelete ? `<button class="ig-menu-btn danger" title="ลบโพสต์นี้" data-action="delete-moment" data-id="${escapeAttr(moment.id)}">⋯</button>` : `<button class="ig-menu-btn" title="เมนู">⋯</button>`}
        </div>
      </header>

      <div class="ig-media-frame ${mediaList.length ? '' : 'no-media'}">
        ${mediaHtml}
      </div>

      <div class="ig-actions-row">
        <div class="ig-left-actions">
          ${['❤️', '😂', '🔥', '😍'].map(emoji => `<button class="ig-action ${activeReactionFor(moment.id)?.emoji === emoji ? 'reacted' : ''}" title="React ได้คนละ 1 ครั้ง เปลี่ยนได้" data-action="react" data-id="${escapeAttr(moment.id)}" data-emoji="${emoji}">${emoji}</button>`).join('')}
          <button class="ig-action" data-action="focus-comment" data-id="${escapeAttr(moment.id)}">💬</button>
          <button class="ig-action" data-action="open-composer" data-source="remix" data-caption="${escapeAttr('โมเมนต์ต่อจาก: ' + (moment.caption || ''))}" data-place="${escapeAttr(moment.place || '')}">➤</button>
        </div>
        <div class="ig-right-actions">
          <button class="ig-action" data-action="toggle-feature" data-id="${escapeAttr(moment.id)}">${moment.featured ? '⭐' : '🔖'}</button>
          ${mediaList.length ? `<button class="ig-action" data-action="download-album" data-id="${escapeAttr(moment.id)}">⬇️</button>` : ''}
        </div>
      </div>

      <div class="ig-post-body">
        ${renderPostUploadStatus(moment, uploadState, mediaPending)}
        ${reactionText ? `<p class="ig-likes"><b>${reactionText}</b> <span>· ${reactions.length} reaction</span></p>` : ''}
        <p class="ig-caption"><b>${escapeHtml(moment.author || 'เพื่อน')}</b> ${escapeHtml(moment.caption || 'Untitled Moment')}</p>
        ${moment.gps ? `<a class="gps-link ig-location" href="https://www.google.com/maps?q=${encodeURIComponent(moment.gps.lat + ',' + moment.gps.lng)}" target="_blank" rel="noreferrer">📍 ดูตำแหน่งเช็กอิน</a>` : ''}
        <p class="ig-meta">${escapeHtml(albumText)}${moment.featured ? ' · อยู่ใน Vlog Studio' : ''}</p>
        ${comments.length ? `<button class="ig-view-comments" data-action="toggle-comments" data-id="${escapeAttr(moment.id)}">ดูคอมเมนต์ทั้งหมด ${comments.length} รายการ</button>` : ''}
        ${renderComments(moment.id)}
      </div>
    </article>
  `;
}

function memberColor(name) {
  const person = accountForDisplay({ name });
  return person?.color || '#0f6b5e';
}

function renderPostUploadStatus(moment, uploadState, mediaPending) {
  if (uploadState === 'uploading') {
    return `<div class="post-upload-state uploading"><span class="upload-spinner"></span><b>กำลังอัปโหลดไฟล์เต็มความละเอียด…</b></div>`;
  }
  if (uploadState === 'error') {
    return `<div class="post-upload-state error"><span>⚠️</span><b>อัปโหลดไม่สำเร็จ</b><button class="mini-link" data-action="retry-upload-moment" data-id="${escapeAttr(moment.id)}">ลองอีกครั้ง</button></div>`;
  }
  if (mediaPending) {
    return `<div class="post-upload-state pending"><span>⏳</span><b>รอส่งไฟล์เต็มขึ้น Hub</b><button class="mini-link" data-action="retry-upload-moment" data-id="${escapeAttr(moment.id)}">ส่งตอนนี้</button></div>`;
  }
  return '';
}

function renderComments(momentId) {
  const comments = (state.comments || [])
    .filter(c => c.momentId === momentId && !c.deleted)
    .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  const preview = comments.slice(-6);
  const moreText = comments.length > preview.length ? `<div class="small muted">มีคอมเมนต์ก่อนหน้าอีก ${comments.length - preview.length} รายการ</div>` : '';
  return `
    <div class="comments-box">
      ${moreText}
      ${preview.map(c => `<div class="comment-line"><b>${escapeHtml(c.author || 'เพื่อน')}</b><span>${escapeHtml(c.text || '')}</span>${canManageItem(c) ? `<button class="mini-link danger" data-action="delete-comment" data-id="${escapeAttr(c.id)}">ลบ</button>` : ''}</div>`).join('')}
      <form class="comment-form" data-form="comment" data-moment-id="${escapeAttr(momentId)}">
        <input class="input" name="text" placeholder="คอมเมนต์ / แซวเพื่อน / เพิ่มบริบทของรูปนี้" required />
        <button class="btn primary" type="submit">ส่ง</button>
      </form>
    </div>
  `;
}

function renderAlbumMedia(mediaList, momentId) {
  if (!mediaList.length) return '<div class="empty album-empty">ไม่มีรูป แต่มีเรื่องให้จำ</div>';
  const count = mediaList.length;
  return `
    <div class="album-carousel" aria-label="อัลบั้ม ${count} ไฟล์">
      ${count > 1 ? `<span class="album-count-badge">1/${count}</span>` : ''}
      ${mediaList.map((media, index) => renderMediaItem(media, momentId, index)).join('')}
    </div>
  `;
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


function renderAccountModal() {
  const accountId = currentAccountId();
  const account = activeAccount() || {};
  return `
    <div class="modal-backdrop" data-action="close-account">
      <div class="composer-modal card account-modal" data-modal-panel role="dialog" aria-modal="true" aria-label="บัญชีของฉัน" tabindex="-1">
        <div class="composer-head">
          <div>
            <h3>บัญชีของฉัน</h3>
            <p class="muted">แก้ชื่อ โปรไฟล์ และรหัสผ่านของบัญชีนี้</p>
          </div>
          <button class="icon-btn" type="button" data-action="close-account" aria-label="ปิดหน้าบัญชี">✕</button>
        </div>
        <form class="stack" data-form="profile">
          <div class="profile-card-preview">
            ${currentAvatar('avatar big')}
            <div><b>${escapeHtml(currentUserName())}</b><p>${currentUserBadge()} · @${escapeHtml(account.username || '')}</p></div>
          </div>
          <div class="field avatar-upload-field">
            <label>รูปโปรไฟล์</label>
            <input class="input" name="avatar" type="file" accept="image/*" />
            <small>เลือกรูปใหม่เพื่อแสดงใน Feed, Story, คอมเมนต์ และรายชื่อสมาชิก</small>
          </div>
          <div class="grid two">
            <div class="field"><label>ชื่อที่แสดง</label><input class="input" name="name" required value="${escapeAttr(state.profile.name || '')}" placeholder="เช่น ต้น" /></div>
            <div class="field"><label>Username</label><input class="input" name="username" value="${escapeAttr(account.username || state.profile.username || '')}" readonly /></div>
            <div class="field"><label>คาแรกเตอร์</label><select class="select" name="role">${['สายคอนเทนต์','สายฮา','สายกิน','สายหลับ','สายเปย์','สายไกด์','สายถ่ายรูป','สายดูแลเพื่อน'].map(x => `<option ${state.profile.role === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
            <div class="field"><label>สีประจำตัว</label><input class="input" name="color" type="color" value="${escapeAttr(state.profile.color || '#0f6b5e')}" /></div>
          </div>
          <div class="password-box">
            <b>เปลี่ยนรหัสผ่าน</b>
            <div class="grid two">
              <div class="field"><label>รหัสปัจจุบัน</label><input class="input" name="currentPassword" type="password" autocomplete="current-password" placeholder="เว้นว่างถ้าไม่เปลี่ยน" /></div>
              <div class="field"><label>รหัสใหม่</label><input class="input" name="newPassword" type="password" autocomplete="new-password" placeholder="อย่างน้อย 4 ตัว" /></div>
            </div>
          </div>
          <div class="action-row">
            <button class="btn primary" type="submit">บันทึกบัญชี</button>
            <button class="btn ghost" type="button" data-action="logout">ออกจากระบบ</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderComposerModal() {
  const isGame = composer.source === 'game';
  const isQuest = composer.source === 'quest';
  return `
    <div class="modal-backdrop" data-action="close-composer">
      <div class="composer-modal card" data-modal-panel role="dialog" aria-modal="true" aria-label="เพิ่มโมเมนต์" tabindex="-1">
        <div class="composer-head">
          <div>
            <h3>${isGame ? 'โพสต์โมเมนต์จากเกม' : isQuest ? 'โพสต์หลักฐานภารกิจ' : 'สร้างโพสต์ใหม่'}</h3>
            <p class="muted">อัปโหลดรูป/วิดีโอได้ทั้งอัลบั้ม พร้อมแคปชันและเช็กอิน</p>
          </div>
          <button class="icon-btn" type="button" data-action="close-composer" aria-label="ปิดหน้าเพิ่มโมเมนต์">✕</button>
        </div>
        <form class="stack" data-form="moment">
          <input type="hidden" name="source" value="${escapeAttr(composer.source)}" />
          <div class="grid two">
            <div class="field"><label>บัญชีที่โพสต์</label><input class="input" name="author" value="${escapeAttr(currentUserName())}" readonly /></div>
            <div class="field"><label>ประเภทโพสต์</label>
              <select class="select" name="type">
                <option value="moment" ${composer.type === 'moment' ? 'selected' : ''}>โพสต์</option>
                <option value="story" ${composer.type === 'story' ? 'selected' : ''}>Story</option>
                <option value="checkin" ${composer.type === 'checkin' ? 'selected' : ''}>เช็กอิน</option>
                <option value="game" ${composer.type === 'game' ? 'selected' : ''}>โมเมนต์จากเกม</option>
                <option value="quest" ${composer.type === 'quest' ? 'selected' : ''}>หลักฐานภารกิจ</option>
                <option value="quote" ${composer.type === 'quote' ? 'selected' : ''}>Quote เด็ด</option>
              </select>
            </div>
          </div>
          ${isGame ? `<div class="game-preview"><span>🎲</span><b>${escapeHtml(composer.gameCard || 'Game Moment')}</b></div>` : ''}
          ${isQuest ? `<div class="game-preview"><span>🧭</span><b>${escapeHtml(composer.questTitle || 'Quest Moment')}</b></div>` : ''}
          <input type="hidden" name="sourceQuestId" value="${escapeAttr(composer.questId || '')}" />
          <input type="hidden" name="sourceQuestTitle" value="${escapeAttr(composer.questTitle || '')}" />
          <div class="field"><label>แคปชัน</label><textarea class="textarea" name="caption" required placeholder="เขียนแคปชันแบบลง IG / เล่าโมเมนต์นี้ให้เพื่อนจำ">${escapeHtml(composer.caption || composer.gameCard || '')}</textarea></div>
          <div class="grid two">
            <div class="field"><label>สถานที่ / เช็กอิน</label><input class="input" name="place" value="${escapeAttr(composer.place || (isGame ? 'เกมบนแพ' : isQuest ? 'ภารกิจแก๊ง' : ''))}" placeholder="เขื่อนเขาแหลม / สะพานมอญ / บนแพ" /></div>
            <div class="field"><label>อารมณ์</label>
              <select class="select" name="mood">
                ${['ตำนาน','ฮา','ซึ้ง','วิวสวย','เหนื่อยแต่คุ้ม','ไม่ควรหลุด','เกมบนแพ'].map(m => `<option ${composer.mood === m ? 'selected' : ''}>${m}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="gps-card">
            <input type="hidden" name="gpsLat" value="${escapeAttr(composer.gps?.lat || '')}" />
            <input type="hidden" name="gpsLng" value="${escapeAttr(composer.gps?.lng || '')}" />
            <input type="hidden" name="gpsAccuracy" value="${escapeAttr(composer.gps?.accuracy || '')}" />
            <div><b>📍 GPS Check-in</b><p>${composer.gps ? `เพิ่มพิกัดแล้ว · ${Number(composer.gps.lat).toFixed(5)}, ${Number(composer.gps.lng).toFixed(5)}` : 'แตะเพื่อเพิ่มตำแหน่งปัจจุบันในโพสต์นี้'}</p></div>
            <button class="btn ghost" type="button" data-action="capture-gps">เพิ่ม GPS</button>
          </div>
          <div class="field"><label>รูป/วิดีโอทั้งอัลบั้ม</label><input class="input" name="media" type="file" accept="image/*,video/*" multiple /></div>
          <div class="composer-tip">รูป/วิดีโอจะถูกเก็บแบบเต็มความละเอียด ไม่บีบอัด</div>
          <button class="btn primary full" type="submit">แชร์ลง Feed</button>
        </form>
      </div>
    </div>
  `;
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
      <div class="spread"><span class="tag">${escapeHtml(q.type)} · +${q.xp} XP</span><div class="action-row tight"><button class="btn ${done ? 'ghost' : 'primary'}" data-action="toggle-quest" data-id="${q.id}">${done ? 'ทำแล้ว ✓' : 'ทำสำเร็จ'}</button><button class="btn ghost" data-action="open-quest-composer" data-id="${q.id}">โพสต์หลักฐาน</button></div></div>
    </div>
  `;
}

function renderGames() {
  const voteList = activeList('votes').sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
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
        <button class="btn full" data-action="open-game-composer">โพสต์โมเมนต์เกมนี้ลง Feed</button>
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
      ${voteList.slice(0, 12).map(v => `<div class="quest-card"><div class="spread"><b>${escapeHtml(v.title)}</b>${canManageItem(v) ? `<button class="btn danger compact-btn" data-action="delete-vote" data-id="${escapeAttr(v.id)}">ลบ</button>` : ''}</div><p class="quest-desc">ผู้ชนะ: ${escapeHtml(v.winner)} — ${escapeHtml(v.reason || '')}</p><p class="small muted">โดย ${escapeHtml(v.author || v.createdBy || 'แก๊งนี้')} · ${formatThaiDate(v.createdAt)}</p></div>`).join('') || '<div class="empty">ยังไม่มีผลโหวต</div>'}
    </section>
  `;
}

function renderSecretBuddy() {
  if (!activeList('members').length) return '<div class="empty">เพิ่มสมาชิกก่อน แล้วค่อยสุ่มภารกิจลับ</div>';
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
  const activeMoments = activeList('moments');
  const featuredMoments = activeMoments.filter(m => m.featured).sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt));
  const bestMoments = (featuredMoments.length ? featuredMoments : [...activeMoments].slice(-9).reverse()).slice(0, 12);
  const quoteList = activeList('quotes').slice(-8).reverse();
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
        <div class="card kpi"><b>${activeMoments.length}</b><span>โมเมนต์</span></div>
        <div class="card kpi"><b>${doneCount}</b><span>เควสต์สำเร็จ</span></div>
        <div class="card kpi"><b>${activeList('votes').length}</b><span>ผลโหวต</span></div>
        <div class="card kpi"><b>${featuredMoments.length}</b><span>โมเมนต์เข้า Vlog</span></div>
      </div>
      <div class="grid two">
        <div class="card pad stack">
          <h3>Vlog Studio / โมเมนต์เด่น</h3><p class="muted">กด ☆ เก็บเข้า Vlog ใน Feed เพื่อเลือกโมเมนต์เด่น ระบบจะใช้กลุ่มนี้ก่อนสร้าง Memory Reel</p>
          <div class="feed">${bestMoments.map(renderMomentCard).join('') || '<div class="empty">ยังไม่มีรูปสำหรับ Recap</div>'}</div>
        </div>
        <div class="card pad stack">
          <h3>Quote เด็ดประจำทริป</h3>
          <form class="inline" data-form="quote">
            <input class="input" name="text" required placeholder="เช่น รูปนี้อย่าลงนะ" style="flex:1; min-width:220px" />
            <button class="btn primary">เพิ่ม Quote</button>
          </form>
          ${quoteList.map(q => `<div class="quest-card"><div class="spread"><b>“${escapeHtml(q.text)}”</b>${canManageItem(q) ? `<button class="btn danger compact-btn" data-action="delete-quote" data-id="${escapeAttr(q.id)}">ลบ</button>` : ''}</div><p class="quest-desc">โดย ${escapeHtml(q.author || 'แก๊งนี้')} · ${formatThaiDate(q.createdAt)}</p></div>`).join('') || '<div class="empty">ยังไม่มี Quote เด็ด</div>'}
        </div>
      </div>
    </section>
  `;
}

function renderTools() {
  const expenseList = activeList('expenses').sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const total = expenseList.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const isAdmin = isAdminAccount();
  const inviteReady = state.settings.firebaseEnabled && state.settings.firebaseProjectId && state.settings.firebaseApiKey && state.settings.firebaseAppId;
  const connectedText = firebase.connected ? 'Social Feed online' : state.settings.firebaseEnabled ? 'พร้อมเชื่อมต่ออัตโนมัติ' : 'ยังไม่ได้ตั้งค่า Hub';
  const mediaText = drive.connected ? 'Drive media online' : state.settings.driveRootFolderId ? 'พื้นที่รูปพร้อมเชื่อมต่อ' : 'ยังไม่มีพื้นที่รูป';

  const adminHubDetails = isAdmin ? `
    <details class="more-details admin-advanced">
      <summary><span>🔐 ตั้งค่าหลังบ้าน Admin</span><small>Firebase / Drive / Invite</small></summary>
      <form class="stack" data-form="settings">
        <div class="grid two compact-form-grid">
          <label class="checkline wide"><input type="checkbox" name="firebaseEnabled" ${state.settings.firebaseEnabled ? 'checked' : ''}> เปิด Social Feed แบบเรียลไทม์</label>
          <div class="field"><label>Trip ID</label><input class="input" name="firebaseTripId" value="${escapeAttr(state.settings.firebaseTripId || 'kannajaburi-trip')}" /></div>
          <div class="field"><label>Project ID</label><input class="input" name="firebaseProjectId" value="${escapeAttr(state.settings.firebaseProjectId || '')}" /></div>
          <div class="field"><label>API Key</label><input class="input" name="firebaseApiKey" value="${escapeAttr(state.settings.firebaseApiKey || '')}" /></div>
          <div class="field"><label>Auth Domain</label><input class="input" name="firebaseAuthDomain" value="${escapeAttr(state.settings.firebaseAuthDomain || '')}" /></div>
          <div class="field"><label>App ID</label><input class="input" name="firebaseAppId" value="${escapeAttr(state.settings.firebaseAppId || '')}" /></div>
          <div class="field"><label>Storage Bucket</label><input class="input" name="firebaseStorageBucket" value="${escapeAttr(state.settings.firebaseStorageBucket || '')}" /></div>
          <div class="field"><label>Messaging Sender ID</label><input class="input" name="firebaseMessagingSenderId" value="${escapeAttr(state.settings.firebaseMessagingSenderId || '')}" /></div>
          <div class="field wide"><label>Google OAuth Client ID</label><input class="input" name="driveClientId" value="${escapeAttr(state.settings.driveClientId)}" /></div>
          <div class="field wide"><label>Trip Drive Folder ID หรือ URL โฟลเดอร์</label><input class="input" name="driveRootFolderId" value="${escapeAttr(state.settings.driveRootFolderId)}" /></div>
          <div class="field"><label>ชื่อโฟลเดอร์รูป</label><input class="input" name="driveRootFolderName" value="${escapeAttr(state.settings.driveRootFolderName)}" /></div>
          <div class="field"><label>Auto Sync (วินาที)</label><input class="input" name="syncIntervalSec" type="number" min="15" max="120" value="${Number(state.settings.syncIntervalSec || 20)}" /></div>
          <label class="checkline"><input type="checkbox" name="autoSyncOnStart" ${state.settings.autoSyncOnStart ? 'checked' : ''}> เปิดแอพแล้วเชื่อมต่ออัตโนมัติ</label>
          <label class="checkline"><input type="checkbox" name="liveSyncEnabled" ${state.settings.liveSyncEnabled ? 'checked' : ''}> อัปเดตระหว่างใช้งาน</label>
          <label class="checkline"><input type="checkbox" name="useIncrementalSync" ${state.settings.useIncrementalSync !== false ? 'checked' : ''}> โหลดเฉพาะข้อมูลใหม่</label>
          <input type="hidden" name="driveManagedByAdmin" value="on" />
        </div>
        <div class="action-row">
          <button class="btn primary" type="submit">บันทึก Hub</button>
          <button class="btn" type="button" data-action="copy-invite-link" ${inviteReady ? '' : 'disabled'}>คัดลอกลิงก์เชิญ</button>
          <button class="btn" type="button" data-action="create-drive-folder">สร้างโฟลเดอร์รูป</button>
          <button class="btn" type="button" data-action="publish-admin-drive">แชร์ Hub ให้ทุกคน</button>
        </div>
      </form>
    </details>` : '';

  const tripSettings = isAdmin ? `
    <details class="more-details">
      <summary><span>🏕️ แก้ข้อมูลทริป</span><small>ชื่อทริป ปลายทาง แผนวันนี้</small></summary>
      <form class="stack" data-form="trip">
        <div class="grid two compact-form-grid">
          <div class="field"><label>ชื่อทริป</label><input class="input" name="title" value="${escapeAttr(state.trip.title || '')}" /></div>
          <div class="field"><label>ปลายทาง</label><input class="input" name="destination" value="${escapeAttr(state.trip.destination || '')}" /></div>
          <div class="field"><label>ช่วง/วันนี้</label><input class="input" name="day" value="${escapeAttr(state.trip.day || '')}" /></div>
          <div class="field"><label>Mood วันนี้</label><input class="input" name="mood" value="${escapeAttr(state.trip.mood || '')}" /></div>
          <div class="field wide"><label>คำอธิบายทริป</label><input class="input" name="subtitle" value="${escapeAttr(state.trip.subtitle || '')}" /></div>
          <div class="field wide"><label>แผนวันนี้ / สิ่งต่อไป</label><input class="input" name="nextPlan" value="${escapeAttr(state.trip.nextPlan || '')}" /></div>
        </div>
        <button class="btn primary" type="submit">บันทึกข้อมูลทริป</button>
      </form>
    </details>` : `
    <div class="more-info-card">
      <span class="tag">${escapeHtml(state.trip.day || 'Trip Mode')}</span>
      <h3>${escapeHtml(state.trip.title || 'ทริปของเรา')}</h3>
      <p>${escapeHtml(state.trip.destination || 'ปลายทางของทริป')}</p>
    </div>`;

  return `
    <section class="more-screen">
      <div class="more-hero card">
        <div class="more-profile-row">
          ${currentAvatar('avatar big')}
          <div>
            <h2>${escapeHtml(currentUserName())}</h2>
            <p>${currentUserBadge()} · ${escapeHtml(state.trip.title || 'Trip Memory App')}</p>
          </div>
          <button class="btn ghost" data-action="open-account">บัญชี</button>
        </div>
        <div class="more-status-grid">
          <span class="more-status ${firebase.connected ? 'ok' : ''}">● ${connectedText}</span>
          <span class="more-status ${drive.connected ? 'ok' : ''}">● ${mediaText}</span>
          <span class="more-status">⏳ Pending ${countPendingRecords()}</span>
        </div>
        <div class="more-main-actions">
          <button class="btn accent full" data-action="auto-connect-hub">เชื่อมต่อและอัปเดตอัตโนมัติ</button>
          <button class="btn full" data-action="upload-pending">ส่งโพสต์ที่รออยู่</button>
        </div>
      </div>

      ${tripSettings}
      ${adminHubDetails}

      <div class="more-card-grid">
        <details class="more-details" open>
          <summary><span>👥 สมาชิก</span><small>${activeList('members').length} คน</small></summary>
          ${isAdmin ? `<form class="grid two compact-form-grid" data-form="member">
            <div class="field"><label>ชื่อเล่น</label><input class="input" name="name" required placeholder="เช่น บอส" /></div>
            <div class="field"><label>สาย</label><select class="select" name="role"><option>สายคอนเทนต์</option><option>สายฮา</option><option>สายกิน</option><option>สายหลับ</option><option>สายเปย์</option><option>สายไกด์</option></select></div>
            <div class="field"><label>สี</label><input class="input" name="color" type="color" value="#0f6b5e" /></div>
            <button class="btn primary" type="submit">เพิ่มสมาชิก</button>
          </form>` : ''}
          ${renderMembers()}
        </details>

        <details class="more-details">
          <summary><span>💸 ค่าใช้จ่าย</span><small>รวม ${money(total)}</small></summary>
          <form class="grid two compact-form-grid" data-form="expense">
            <div class="field"><label>รายการ</label><input class="input" name="title" required placeholder="ค่าแพ / ค่าเรือ / ค่าอาหาร" /></div>
            <div class="field"><label>จำนวนเงิน</label><input class="input" name="amount" required type="number" min="0" step="0.01" /></div>
            <div class="field"><label>คนจ่าย</label>${memberSelect('payer', '')}</div>
            <button class="btn primary" type="submit">เพิ่มรายการ</button>
          </form>
          <div class="expense-list-compact">
            ${expenseList.slice(0, 20).map(e => `<div class="expense-row"><div><b>${escapeHtml(e.title)}</b><small>${escapeHtml(e.payer || '-')} · ${formatThaiDate(e.createdAt)}</small></div><b>${money(e.amount)}</b>${canManageItem(e) ? `<button class="mini-link danger" data-action="delete-expense" data-id="${escapeAttr(e.id)}">ลบ</button>` : ''}</div>`).join('') || '<div class="empty">ยังไม่มีค่าใช้จ่าย</div>'}
          </div>
        </details>

        <details class="more-details">
          <summary><span>✅ Checklist</span><small>ของจำเป็น</small></summary>
          <div class="checklist-compact">
            ${PACKING_ITEMS.map((x, i) => `<label><input type="checkbox" data-action="checklist" data-index="${i}" ${state.checklist?.items?.[i] ? 'checked' : ''}> <span>${escapeHtml(x)}</span></label>`).join('')}
          </div>
        </details>

        <details class="more-details">
          <summary><span>🗂️ Backup & App</span><small>สำรอง / ติดตั้ง / ล้างเครื่องนี้</small></summary>
          <div class="grid two compact-form-grid">
            <button class="btn" data-action="export-state">Export Backup</button>
            <label class="btn" for="importStateInput">Import Backup</label>
            <input id="importStateInput" type="file" accept="application/json" hidden />
            <button class="btn accent" data-action="install-app">ติดตั้งแอพ</button>
            <button class="btn danger" data-action="reset-local">ล้างข้อมูล Local</button>
          </div>
        </details>
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


function storySourceList() {
  const sorted = activeList('moments').sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const storyMoments = sorted.filter(m => (m.type === 'story' || m.story === true || m.source === 'story') && (m.media || []).length);
  const fallback = sorted.filter(m => (m.media || []).length && m.type !== 'story').slice(0, Math.max(0, 8 - storyMoments.length));
  return [...storyMoments, ...fallback].slice(0, 12);
}

function openStory(id) {
  const list = storySourceList();
  const index = Math.max(0, list.findIndex(m => m.id === id));
  storyViewer = { open: true, id: list[index]?.id || id, index, timer: null };
  render();
}

function closeStory() {
  if (storyViewer.timer) clearTimeout(storyViewer.timer);
  storyViewer = { open: false, id: '', index: 0, timer: null };
  render();
}

function moveStory(delta = 1) {
  const list = storySourceList();
  if (!list.length) return closeStory();
  const next = (storyViewer.index + delta + list.length) % list.length;
  storyViewer = { open: true, id: list[next].id, index: next, timer: null };
  render();
}

function renderStoryViewer() {
  const list = storySourceList();
  const story = list[storyViewer.index] || list.find(m => m.id === storyViewer.id);
  if (!story) return '';
  const mediaList = Array.isArray(story.media) ? story.media : [];
  return `
    <div class="story-viewer" data-action="close-story">
      <div class="story-panel" data-modal-panel>
        <div class="story-progress">${list.map((_, i) => `<span class="${i <= storyViewer.index ? 'active' : ''}"></span>`).join('')}</div>
        <header class="story-viewer-head">
          ${renderAvatar({ accountId: story.authorId, name: story.author })}
          <div><b>${escapeHtml(story.author || 'เพื่อน')}</b><p>${formatThaiDate(story.createdAt)}</p></div>
          <button class="icon-btn" data-action="close-story" aria-label="ปิด Story">✕</button>
        </header>
        <div class="story-media-stage">${mediaList.length ? renderMedia(mediaList[0]) : '<span>Story</span>'}</div>
        <div class="story-caption"><b>${escapeHtml(story.place || story.mood || 'Story')}</b><p>${escapeHtml(story.caption || '')}</p></div>
        <button class="story-nav prev" data-action="prev-story">‹</button>
        <button class="story-nav next" data-action="next-story">›</button>
      </div>
    </div>
  `;
}

function buildReelItems() {
  const cover = [{ kicker: 'Memory Reel', title: state.trip.title, text: state.trip.subtitle, media: [] }];
  const activeMoments = activeList('moments');
  const sourceMoments = activeMoments.some(m => m.featured)
    ? activeMoments.filter(m => m.featured)
    : activeMoments;
  const moments = [...sourceMoments].sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt)).map(m => ({
    kicker: `${m.author || 'แก๊งนี้'} · ${m.place || 'กาญจนบุรี'}${m.featured ? ' · Vlog Pick' : ''}`,
    title: m.caption || 'โมเมนต์ที่อยากจำ',
    text: `${m.mood || 'ตำนาน'} · ${formatThaiDate(m.createdAt)}`,
    media: m.media || []
  }));
  const votes = activeList('votes').slice(-5).map(v => ({ kicker: 'Vote Award', title: v.title, text: `${v.winner} — ${v.reason || 'ตำนานประจำทริป'}`, media: [] }));
  const end = [{ kicker: 'Trip Recap', title: `XP รวม ${scoreFromState(state)}`, text: `โมเมนต์ ${activeMoments.length} · เควสต์ ${Object.keys(state.questsDone).length}/${QUESTS.length} · สมาชิก ${activeList('members').length}`, media: [] }];
  return [...cover, ...moments, ...votes, ...end];
}


function openComposer(dataset = {}) {
  currentPage = 'feed';
  composer = {
    open: true,
    source: dataset.source || 'feed',
    caption: dataset.caption || '',
    place: dataset.place || '',
    mood: dataset.mood || 'ตำนาน',
    type: dataset.type || 'moment',
    gameCard: dataset.gameCard || '',
    questId: dataset.questId || dataset.id || '',
    questTitle: dataset.questTitle || '',
    gps: null
  };
  render();
}

function openGameComposer() {
  const text = sessionStorage.getItem('currentGameCard');
  if (!text) return toast('เปิดการ์ดเกมก่อน แล้วค่อยโพสต์โมเมนต์');
  composer = {
    open: true,
    source: 'game',
    caption: text,
    place: 'เกมบนแพ',
    mood: 'เกมบนแพ',
    type: 'game',
    gameCard: text
  };
  currentPage = 'feed';
  render();
}


function openQuestComposer(id) {
  const quest = QUESTS.find(q => q.id === id);
  if (!quest) return toast('ไม่พบภารกิจนี้');
  composer = {
    open: true,
    source: 'quest',
    caption: `หลักฐานภารกิจ: ${quest.title}`,
    place: quest.day === 'Day 1' ? 'เขื่อนเขาแหลม / บนแพ' : quest.day === 'Day 2' ? 'สังขละบุรี' : 'กาญนะจ๊ะบุรีทริป',
    mood: 'ตำนาน',
    type: 'quest',
    gameCard: '',
    questId: quest.id,
    questTitle: quest.title
  };
  currentPage = 'feed';
  render();
}

function closeComposer() {
  composer = { open: false, source: 'feed', caption: '', place: '', mood: 'ตำนาน', type: 'moment', gameCard: '', gps: null };
  render();
}

function onKeyDown(event) {
  if (event.key !== 'Escape') return;
  if (composer.open) return closeComposer();
  if (storyViewer.open) return closeStory();
  if (state.accountModalOpen) { state.accountModalOpen = false; persist(); render(); return; }
  if (reel.open) return closeReel();
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
  // Modal backdrops close only when tapping the dimmed area itself; buttons inside modals keep working.
  // Using capture mode makes the ✕ buttons reliable even on mobile browsers/PWA mode.
  if (btn.classList.contains('modal-backdrop') && event.target !== btn) return;
  if (btn.classList.contains('story-viewer') && event.target !== btn) return;
  const action = btn.dataset.action;
  if (action && btn.tagName === 'BUTTON') event.preventDefault();

  try {
    if (action === 'quick-moment' || action === 'open-composer') return openComposer(btn.dataset);
    if (action === 'quick-story') return openComposer({ source: 'story', type: 'story', mood: 'Story', caption: '', place: state.trip.destination || '' });
    if (action === 'quick-checkin') return openComposer({ source: 'checkin', type: 'checkin', mood: 'เช็กอิน', caption: 'เช็กอินทริปนี้', place: state.trip.destination || '' });
    if (action === 'open-story') return openStory(btn.dataset.id);
    if (action === 'close-story') return closeStory();
    if (action === 'next-story') return moveStory(1);
    if (action === 'prev-story') return moveStory(-1);
    if (action === 'logout') return logoutAccount();
    if (action === 'capture-gps') return captureGpsForComposer();
    if (action === 'open-account') { state.accountModalOpen = true; render(); return; }
    if (action === 'close-account') { state.accountModalOpen = false; persist(); render(); return; }
    if (action === 'close-composer') return closeComposer();
    if (action === 'start-game') { currentPage = 'games'; render(); return; }
    if (action === 'toggle-quest') return toggleQuest(btn.dataset.id);
    if (action === 'random-quest') return randomQuest();
    if (action === 'draw-card') return drawCard();
    if (action === 'open-game-composer') return openGameComposer();
    if (action === 'open-quest-composer') return openQuestComposer(btn.dataset.id);
    if (action === 'save-game-moment') return saveCurrentGameAsMoment();
    if (action === 'make-bingo') return makeBingo();
    if (action === 'mark-bingo') return markBingo(Number(btn.dataset.index));
    if (action === 'make-secret-buddy') return makeSecretBuddy();
    if (action === 'complete-secret-buddy') return completeSecretBuddy();
    if (action === 'react') return reactToMoment(btn.dataset.id, btn.dataset.emoji);
    if (action === 'delete-comment') return deleteComment(btn.dataset.id);
    if (action === 'delete-moment') return deleteMoment(btn.dataset.id);
    if (action === 'delete-expense') return deleteExpense(btn.dataset.id);
    if (action === 'delete-vote') return deleteVote(btn.dataset.id);
    if (action === 'delete-quote') return deleteQuote(btn.dataset.id);
    if (action === 'delete-member') return deleteMember(btn.dataset.id);
    if (action === 'checklist') return toggleChecklist(Number(btn.dataset.index));
    if (action === 'toggle-feature') return toggleFeaturedMoment(btn.dataset.id);
    if (action === 'download-media') return downloadMomentMedia(btn.dataset.momentId, Number(btn.dataset.mediaIndex || 0));
    if (action === 'download-album') return downloadMomentAlbum(btn.dataset.id);
    if (action === 'retry-upload-moment') return retryUploadMoment(btn.dataset.id);
    if (action === 'auto-connect-hub') return autoConnectHub();
    if (action === 'focus-comment') return focusCommentInput(btn.dataset.id);
    if (action === 'toggle-comments') return toggleCommentsView(btn.dataset.id);
    if (action === 'connect-firebase') return connectFirebase();
    if (action === 'push-firebase') return uploadPendingSocialRecords();
    if (action === 'connect-drive') return connectDrive();
    if (action === 'create-drive-folder') return createDriveFolder();
    if (action === 'sync-drive') return syncDrive();
    if (action === 'full-sync') return fullSyncDrive();
    if (action === 'upload-pending') return uploadPendingMoments();
    if (action === 'publish-admin-drive') return publishAdminDriveSettings();
    if (action === 'copy-invite-link') return copyAdminInviteLink();
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
    if (type === 'admin-login') return loginAdmin(new FormData(form));
    if (type === 'member-login') return loginMember(new FormData(form));
    if (type === 'profile') return saveProfile(new FormData(form));
    if (type === 'trip') return saveTripSettings(new FormData(form));
    if (type === 'member') return addMember(new FormData(form), form);
    if (type === 'moment') return addMoment(new FormData(form), form);
    if (type === 'settings') return saveSettings(new FormData(form));
    if (type === 'expense') return addExpense(new FormData(form), form);
    if (type === 'quote') return addQuote(new FormData(form), form);
    if (type === 'vote') return addVote(new FormData(form), form);
    if (type === 'comment') return addComment(new FormData(form), form);
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


async function loginAdmin(data) {
  const username = normalizeUsername(data.get('username') || DEFAULT_ADMIN_USERNAME);
  const password = String(data.get('password') || '');
  if (username !== DEFAULT_ADMIN_USERNAME) throw new Error('Admin username ต้องเป็น admin');
  let admin = (state.accounts || []).find(a => isActiveItem(a) && a.isAdmin && normalizeUsername(a.username || a.name) === DEFAULT_ADMIN_USERNAME);
  if (!admin) {
    if (password !== DEFAULT_ADMIN_PASSWORD) throw new Error('รหัส Admin เริ่มต้นไม่ถูกต้อง');
    admin = await createAccount({
      username: DEFAULT_ADMIN_USERNAME,
      password: DEFAULT_ADMIN_PASSWORD,
      name: 'Admin',
      role: 'ผู้ดูแลทริป',
      color: '#111827',
      isAdmin: true,
      mustChangePassword: true
    });
  } else {
    const ok = await verifyAccountPassword(admin, password);
    if (!ok) throw new Error('รหัสผ่าน Admin ไม่ถูกต้อง');
  }
  applyAccountToProfile(admin);
  ensureMemberForAccount(admin);
  persist();
  toast(admin.mustChangePassword ? 'เข้าสู่ระบบ Admin แล้ว แนะนำให้เปลี่ยนรหัสผ่าน' : 'เข้าสู่ระบบ Admin แล้ว');
  render();
  setTimeout(autoConnectFirebaseOnStart, 250);
  setTimeout(autoConnectDriveOnStart, 600);
}

async function loginMember(data) {
  const username = normalizeUsername(data.get('username') || '');
  const password = String(data.get('password') || '');
  let account = findAccountByUsername(username);
  if (account) {
    const ok = await verifyAccountPassword(account, password);
    if (!ok) throw new Error('รหัสผ่านไม่ถูกต้อง');
  } else {
    account = await createAccount({
      username,
      password,
      name: String(data.get('name') || username).trim(),
      role: String(data.get('role') || 'สายคอนเทนต์'),
      color: '#0f6b5e',
      isAdmin: false
    });
  }
  applyAccountToProfile(account);
  ensureMemberForAccount(account);
  persist();
  toast(`เข้าสู่ระบบแล้ว: ${account.name || account.username}`);
  render();
  setTimeout(autoConnectFirebaseOnStart, 250);
  setTimeout(autoConnectDriveOnStart, 600);
}

async function captureGpsForComposer() {
  if (!navigator.geolocation) return toast('เครื่องนี้ไม่รองรับ GPS');
  toast('กำลังขอตำแหน่ง GPS…');
  navigator.geolocation.getCurrentPosition(position => {
    composer.gps = {
      lat: Number(position.coords.latitude),
      lng: Number(position.coords.longitude),
      accuracy: Math.round(Number(position.coords.accuracy || 0)),
      capturedAt: new Date().toISOString()
    };
    if (!composer.place) composer.place = 'ตำแหน่งปัจจุบัน';
    toast('เพิ่ม GPS ในโพสต์แล้ว');
    render();
  }, error => {
    toast(error.message || 'ไม่สามารถดึง GPS ได้');
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
}

async function saveTripSettings(data) {
  if (!requireAdmin('เฉพาะ Admin เท่านั้นที่แก้ข้อมูลทริปได้')) return;
  state.trip ||= {};
  const now = new Date().toISOString();
  state.trip.title = String(data.get('title') || state.trip.title || state.appName || '').trim() || 'Trip Memory';
  state.trip.subtitle = String(data.get('subtitle') || '').trim() || 'แชร์รูป เช็กอิน เล่นเกม และเก็บความทรงจำร่วมกัน';
  state.trip.destination = String(data.get('destination') || '').trim() || 'ทริปของเรา';
  state.trip.day = String(data.get('day') || '').trim() || 'วันนี้';
  state.trip.mood = String(data.get('mood') || '').trim() || 'พร้อมสร้างโมเมนต์';
  state.trip.nextPlan = String(data.get('nextPlan') || '').trim();
  const record = { id: 'trip-profile', ...state.trip, updatedAt: now, updatedBy: currentUserName(), accountId: currentAccountId(), storage: 'local' };
  state.tripSettings ||= [];
  const index = state.tripSettings.findIndex(x => x.id === record.id);
  if (index >= 0) state.tripSettings[index] = { ...state.tripSettings[index], ...record };
  else state.tripSettings.push(record);
  persist();
  await uploadRecordIfConnected('tripSettings', record);
  toast('บันทึกข้อมูลทริปแล้ว');
  render();
}

async function saveProfile(data) {
  const now = new Date().toISOString();
  const account = activeAccount();
  if (!account) throw new Error('กรุณาเข้าสู่ระบบใหม่');
  const currentPassword = String(data.get('currentPassword') || '');
  const newPassword = String(data.get('newPassword') || '');
  if (newPassword) {
    if (newPassword.length < 4) throw new Error('รหัสใหม่ต้องมีอย่างน้อย 4 ตัว');
    const ok = await verifyAccountPassword(account, currentPassword);
    if (!ok) throw new Error('รหัสปัจจุบันไม่ถูกต้อง');
    account.passwordHash = await passwordHash(account.username || account.name, newPassword);
    account.mustChangePassword = false;
  }
  account.name = String(data.get('name') || '').trim();
  account.role = String(data.get('role') || 'สายคอนเทนต์');
  account.color = String(data.get('color') || '#0f6b5e');
  const avatarFile = data.get('avatar');
  if (avatarFile && avatarFile.size) {
    try {
      account.avatarDataUrl = await fileToOptimizedDataUrl(avatarFile, 720, 0.86);
    } catch (error) {
      console.warn('Avatar optimization fallback:', error);
      account.avatarDataUrl = await fileToDataUrl(avatarFile);
    }
    account.avatarMimeType = avatarFile.type || 'image/jpeg';
    account.avatarName = avatarFile.name || 'profile-image';
    account.avatarUpdatedAt = now;
  }
  account.updatedAt = now;
  account.storage = account.storage === 'firebase' ? 'local' : account.storage || 'local';
  state.profile.name = account.name;
  state.profile.username = account.username;
  state.profile.role = account.role;
  state.profile.color = account.color;
  state.profile.avatarDataUrl = account.avatarDataUrl || '';
  state.profile.avatarMimeType = account.avatarMimeType || '';
  state.profile.avatarName = account.avatarName || '';
  state.profile.isAdmin = Boolean(account.isAdmin);
  const index = state.accounts.findIndex(a => a.id === account.id);
  if (index >= 0) state.accounts[index] = account;
  const member = ensureMemberForAccount(account);
  state.accountModalOpen = false;
  saveAccountSession(account);
  persist();
  render();
  toast(newPassword ? 'บันทึกบัญชีและเปลี่ยนรหัสแล้ว' : 'บันทึกบัญชีแล้ว');
  Promise.all([uploadRecordIfConnected('accounts', account), member ? uploadRecordIfConnected('members', member) : Promise.resolve()])
    .then(() => { persist(); renderSyncStatusOnly(); })
    .catch(error => {
      console.warn('Account saved locally; sync will retry later:', error);
      state.settings.lastFirebaseError = error.message || String(error);
      persist();
    });
}

async function addMember(data, form) {
  const name = String(data.get('name') || '').trim();
  if (!name) return;
  const memberId = uid('member');
  const member = {
    id: memberId,
    accountId: memberId,
    name,
    role: data.get('role') || 'สายคอนเทนต์',
    color: data.get('color') || '#0f6b5e',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    storage: 'local'
  };
  state.members.push(member);
  if (!state.profile.name) { state.profile.name = name; state.profile.accountId = member.accountId; state.profile.role = member.role; state.profile.color = member.color; }
  persist();
  await uploadRecordIfConnected('members', member);
  form.reset();
  toast(`เพิ่ม ${name} แล้ว`);
  render();
}

async function addMoment(data, form) {
  const submitBtn = form.querySelector('button[type="submit"]');
  const originalLabel = submitBtn?.textContent || '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'กำลังเตรียมโพสต์…';
  }
  uploadUi = { active: true, tone: 'info', text: 'กำลังเก็บไฟล์ต้นฉบับไว้ในเครื่องก่อนอัปโหลด…' };

  const files = data.getAll('media').filter(file => file && file.size);
  const author = String(data.get('author') || state.profile.name || 'แก๊งนี้').trim();
  const now = new Date().toISOString();
  let moment = {
    id: uid('moment'),
    type: data.get('type') || 'moment',
    author,
    authorId: currentAccountId(),
    source: String(data.get('source') || composer.source || 'feed'),
    sourceQuestId: String(data.get('sourceQuestId') || '').trim(),
    sourceQuestTitle: String(data.get('sourceQuestTitle') || '').trim(),
    caption: String(data.get('caption') || '').trim(),
    place: String(data.get('place') || '').trim(),
    mood: data.get('mood') || 'ตำนาน',
    createdAt: now,
    updatedAt: now,
    media: [],
    gps: data.get('gpsLat') ? {
      lat: Number(data.get('gpsLat')),
      lng: Number(data.get('gpsLng')),
      accuracy: Number(data.get('gpsAccuracy') || 0),
      capturedAt: composer.gps?.capturedAt || now
    } : null,
    uploadState: files.length ? 'pending' : 'local',
    uploadMessage: files.length ? 'บันทึกไฟล์ต้นฉบับไว้แล้ว กำลังส่งขึ้น Hub' : 'โพสต์ข้อความ',
    storage: 'local'
  };

  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      uploadUi = { active: true, tone: 'info', text: `กำลังเตรียมไฟล์ ${index + 1}/${files.length}: ${file.name}` };
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

    state.moments.push(moment);
    persist();
    form.reset();
    closeComposer();
    toast(files.length ? 'สร้างโพสต์แล้ว กำลังอัปโหลดไฟล์เต็มความละเอียด' : 'แชร์โพสต์แล้ว');

    if (moment.type === 'quote') {
      const quote = { id: uid('quote'), text: moment.caption, author, accountId: currentAccountId(), createdBy: author, createdById: currentAccountId(), sourceMomentId: moment.id, createdAt: moment.createdAt, updatedAt: moment.updatedAt, storage: moment.storage };
      state.quotes.push(quote);
      await uploadRecordIfConnected('quotes', quote);
    }

    moment.uploadState = files.length ? 'uploading' : 'syncing';
    moment.uploadMessage = files.length ? 'กำลังส่งไฟล์เต็มความละเอียดขึ้น Google Drive' : 'กำลังส่งข้อมูลโพสต์';
    uploadUi = { active: true, tone: 'info', text: moment.uploadMessage };
    persist();
    render();

    const ok = await uploadMomentRecordIfConnected(moment);
    moment.uploadState = ok ? 'synced' : (files.length ? 'pending' : 'local');
    moment.uploadMessage = ok ? 'ซิงก์สำเร็จ' : 'ยังรอส่งขึ้น Hub';
    moment.updatedAt = new Date().toISOString();
    uploadUi = ok ? { active: false, text: '', tone: 'success' } : { active: false, text: '', tone: 'warning' };
    persist();
    toast(ok ? 'โพสต์ขึ้น Hub แล้ว' : 'บันทึกไว้ในเครื่องแล้ว รอเชื่อมต่อเพื่ออัปโหลด');
    render();
  } catch (error) {
    console.error(error);
    moment.uploadState = 'error';
    moment.uploadMessage = error.message || 'อัปโหลดไม่สำเร็จ';
    uploadUi = { active: false, text: '', tone: 'error' };
    persist();
    toast(error.message || 'อัปโหลดไม่สำเร็จ');
    render();
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  }
}

async function retryUploadMoment(id) {
  const moment = state.moments.find(item => item.id === id && !item.deleted);
  if (!moment) return toast('ไม่พบโพสต์นี้');
  moment.uploadState = 'uploading';
  moment.uploadMessage = 'กำลังอัปโหลดซ้ำ…';
  uploadUi = { active: true, tone: 'info', text: 'กำลังส่งโพสต์และไฟล์ขึ้น Hub…' };
  persist();
  render();
  try {
    const ok = await uploadMomentRecordIfConnected(moment);
    moment.uploadState = ok ? 'synced' : 'pending';
    moment.uploadMessage = ok ? 'ซิงก์สำเร็จ' : 'ยังรอเชื่อมต่อ Hub';
    moment.updatedAt = new Date().toISOString();
    uploadUi = { active: false, text: '', tone: ok ? 'success' : 'warning' };
    persist();
    toast(ok ? 'อัปโหลดสำเร็จ' : 'ยังอัปโหลดไม่ได้ ตรวจการเชื่อมต่อ Hub');
  } catch (error) {
    console.error(error);
    moment.uploadState = 'error';
    moment.uploadMessage = error.message || 'อัปโหลดไม่สำเร็จ';
    uploadUi = { active: false, text: '', tone: 'error' };
    persist();
    toast(error.message || 'อัปโหลดไม่สำเร็จ');
  }
  render();
}

async function uploadMomentWithStoredMedia(moment, options = {}) {
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
  if (!options.skipDriveRecord) await drive.uploadRecord('moments', uploadPayload);

  const localMoment = structuredClone(remoteMoment);
  localMoment.media = (localMoment.media || []).map((media, index) => localBlobIds[index] ? { ...media, localBlobId: localBlobIds[index] } : media);
  return localMoment;
}

function stripTransientMedia(media = {}) {
  const { localBlobId, localDataUrl, ...clean } = media;
  return clean;
}

function saveSettings(data) {
  if (!requireAdmin('เฉพาะ Admin เท่านั้นที่ตั้งค่า Firebase/Drive ได้')) return;
  const oldFolder = state.settings.driveRootFolderId;
  state.settings.driveClientId = String(data.get('driveClientId') || '').trim();
  state.settings.driveRootFolderId = extractDriveFolderId(String(data.get('driveRootFolderId') || '').trim());
  state.settings.driveRootFolderName = String(data.get('driveRootFolderName') || 'กาญนะจ๊ะบุรีทริป - Shared Memories').trim();
  state.settings.firebaseEnabled = data.get('firebaseEnabled') === 'on';
  state.settings.firebaseTripId = safeTripId(String(data.get('firebaseTripId') || 'kannajaburi-trip'));
  state.settings.firebaseApiKey = String(data.get('firebaseApiKey') || '').trim();
  state.settings.firebaseAuthDomain = String(data.get('firebaseAuthDomain') || '').trim();
  state.settings.firebaseProjectId = String(data.get('firebaseProjectId') || '').trim();
  state.settings.firebaseStorageBucket = String(data.get('firebaseStorageBucket') || '').trim();
  state.settings.firebaseMessagingSenderId = String(data.get('firebaseMessagingSenderId') || '').trim();
  state.settings.firebaseAppId = String(data.get('firebaseAppId') || '').trim();
  state.settings.autoSyncOnStart = data.get('autoSyncOnStart') === 'on';
  state.settings.liveSyncEnabled = data.get('liveSyncEnabled') === 'on';
  state.settings.useIncrementalSync = data.get('useIncrementalSync') === 'on';
  state.settings.driveManagedByAdmin = data.get('driveManagedByAdmin') === 'on';
  state.settings.syncIntervalSec = Math.min(120, Math.max(15, Number(data.get('syncIntervalSec') || 20)));
  state.settings.syncMode = state.settings.firebaseEnabled ? 'firebase-first' : 'drive-first';
  if (oldFolder !== state.settings.driveRootFolderId) {
    state.settings.driveChildren = {};
    state.settings.collectionSyncAt = {};
  }
  persist();
  if (state.settings.liveSyncEnabled && drive.connected && !state.settings.firebaseEnabled) startSyncLoop();
  else stopSyncLoop();
  toast('บันทึกการตั้งค่าแล้ว');
  render();
}

async function addExpense(data, form) {
  const now = new Date().toISOString();
  const actor = currentActorMeta();
  const expense = {
    id: uid('expense'),
    title: String(data.get('title') || '').trim(),
    amount: Number(data.get('amount') || 0),
    payer: String(data.get('payer') || '').trim(),
    author: actor.author,
    accountId: actor.accountId,
    createdBy: actor.author,
    createdById: actor.accountId,
    createdAt: now,
    updatedAt: now,
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
  const actor = currentActorMeta();
  const author = actor.author;
  const quote = { id: uid('quote'), text, author, accountId: actor.accountId, createdBy: actor.author, createdById: actor.accountId, createdAt: now, updatedAt: now, storage: 'local' };
  const moment = { id: uid('moment'), type: 'quote', author, authorId: actor.accountId, sourceQuoteId: quote.id, caption: text, place: 'Quote ประจำทริป', mood: 'ตำนาน', createdAt: now, updatedAt: now, media: [], storage: 'local' };
  quote.sourceMomentId = moment.id;
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
  const actor = currentActorMeta();
  const vote = {
    id: uid('vote'),
    title: String(data.get('title') || '').trim(),
    winner: String(data.get('winner') || '').trim(),
    reason: String(data.get('reason') || '').trim(),
    author: actor.author,
    accountId: actor.accountId,
    createdBy: actor.author,
    createdById: actor.accountId,
    createdAt: now,
    updatedAt: now,
    storage: 'local'
  };
  const moment = {
    id: uid('moment'),
    type: 'vote',
    author: actor.author,
    authorId: actor.accountId,
    sourceVoteId: vote.id,
    caption: `${vote.title}: ${vote.winner}`,
    place: vote.reason,
    mood: 'รางวัลประจำวัน',
    createdAt: now,
    updatedAt: now,
    media: [],
    gps: data.get('gpsLat') ? {
      lat: Number(data.get('gpsLat')),
      lng: Number(data.get('gpsLng')),
      accuracy: Number(data.get('gpsAccuracy') || 0),
      capturedAt: composer.gps?.capturedAt || new Date().toISOString()
    } : null,
    storage: 'local'
  };
  vote.momentId = moment.id;
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
    author: currentUserName(),
    accountId: currentAccountId(),
    createdBy: currentUserName(),
    createdById: currentAccountId(),
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
  const moment = { id: uid('moment'), type: 'game', author: currentUserName(), authorId: currentAccountId(), caption: text, place: 'เกมบนแพ', mood: 'ฮา', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), media: [], storage: 'local' };
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
  const members = activeList('members');
  if (!members.length) return toast('เพิ่มสมาชิกก่อน');
  const player = pick(members).name;
  const targets = members.filter(m => m.name !== player);
  const target = targets.length ? pick(targets).name : 'เพื่อนในแก๊ง';
  const missions = [
    `ทำให้ ${target} หัวเราะโดยห้ามบอกว่าเป็นภารกิจ`,
    `ถ่ายรูปเผลอ ${target} ให้ดูดี`,
    `ช่วยถือของหรือดูแล ${target} แบบเนียน ๆ`,
    `ชวน ${target} คุยเรื่องที่อยากทำก่อนอายุ 30`,
    `ทำให้ ${target} ได้รูปโปรไฟล์ใหม่`,
    `ชม ${target} แบบจริงใจจนเขางง`
  ];
  state.secretBuddy = { id: 'shared-secret-buddy', type: 'secretBuddy', player, target, mission: pick(missions), author: currentUserName(), accountId: currentAccountId(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), storage: 'local' };
  persist();
  uploadRecordIfConnected('games', state.secretBuddy).catch(console.warn);
  toast('สุ่ม Secret Buddy แล้ว');
  render();
}

async function completeSecretBuddy() {
  if (!state.secretBuddy) return;
  const now = new Date().toISOString();
  const moment = { id: uid('moment'), type: 'secret', author: currentUserName(), authorId: currentAccountId(), caption: `Secret Buddy สำเร็จ: ${state.secretBuddy.mission}`, place: 'ภารกิจลับ', mood: 'อบอุ่น', createdAt: now, updatedAt: now, media: [], storage: 'local' };
  const completed = { ...state.secretBuddy, completed: true, completedAt: now, completedBy: currentUserName(), completedById: currentAccountId(), updatedAt: now, storage: 'local' };
  state.moments.push(moment);
  state.secretBuddy = null;
  persist();
  await Promise.all([uploadMomentRecordIfConnected(moment), uploadRecordIfConnected('games', completed)]);
  toast('Secret Buddy สำเร็จ +25 XP');
  render();
}

async function addComment(data, form) {
  const text = String(data.get('text') || '').trim();
  const momentId = form.dataset.momentId;
  if (!text || !momentId) return;
  if (!ensureMomentActive(momentId)) return toast('โพสต์นี้ถูกลบหรือไม่พร้อมคอมเมนต์แล้ว');
  const now = new Date().toISOString();
  const comment = {
    id: uid('comment'),
    momentId,
    text,
    author: currentUserName(),
    accountId: currentAccountId(),
    createdAt: now,
    updatedAt: now,
    storage: 'local'
  };
  state.comments ||= [];
  state.comments.push(comment);
  persist();
  await uploadRecordIfConnected('comments', comment);
  form.reset();
  toast('คอมเมนต์แล้ว');
  render();
}

async function softDeleteRecord(collection, key, id, label = 'รายการ') {
  const list = ensureCollection(key);
  const item = list.find(entry => entry.id === id);
  if (!item || item.deleted) return toast(`ไม่พบ${label}นี้ หรือถูกลบไปแล้ว`);
  if (!canManageItem(item)) return toast(`ลบ${label}ได้เฉพาะเจ้าของหรือ Admin`);
  if (!confirm(`ยืนยันลบ${label}นี้?`)) return;
  const now = new Date().toISOString();
  item.deleted = true;
  item.deletedAt = now;
  item.deletedBy = currentUserName();
  item.deletedById = currentAccountId();
  item.updatedAt = now;
  item.storage = 'local';
  persist();
  await uploadRecordIfConnected(collection, item);
  toast(`ลบ${label}แล้ว`);
  render();
  return item;
}

async function deleteExpense(id) {
  return softDeleteRecord('expenses', 'expenses', id, 'ค่าใช้จ่าย');
}

async function deleteComment(id) {
  return softDeleteRecord('comments', 'comments', id, 'คอมเมนต์');
}

async function deleteMoment(id) {
  const moment = await softDeleteRecord('moments', 'moments', id, 'โพสต์');
  if (!moment) return;
  // คอมเมนต์และ reaction ยังเก็บไว้เป็นประวัติใน Firebase/Drive แต่จะไม่ถูกแสดงเพราะโพสต์ถูกซ่อนแล้ว
}

async function deleteVote(id) {
  const vote = await softDeleteRecord('votes', 'votes', id, 'ผลโหวต');
  if (!vote) return;
  const linkedMoment = state.moments.find(m => m.sourceVoteId === vote.id || m.id === vote.momentId);
  if (linkedMoment && !linkedMoment.deleted && canManageItem(vote)) {
    const now = new Date().toISOString();
    linkedMoment.deleted = true;
    linkedMoment.deletedAt = now;
    linkedMoment.deletedBy = currentUserName();
    linkedMoment.deletedById = currentAccountId();
    linkedMoment.updatedAt = now;
    linkedMoment.storage = 'local';
    await uploadMomentRecordIfConnected(linkedMoment);
    persist();
  }
}

async function deleteQuote(id) {
  const quote = await softDeleteRecord('quotes', 'quotes', id, 'Quote');
  if (!quote) return;
  const linkedMoment = state.moments.find(m => m.sourceQuoteId === quote.id || m.id === quote.sourceMomentId);
  if (linkedMoment && !linkedMoment.deleted && canManageItem(quote)) {
    const now = new Date().toISOString();
    linkedMoment.deleted = true;
    linkedMoment.deletedAt = now;
    linkedMoment.deletedBy = currentUserName();
    linkedMoment.deletedById = currentAccountId();
    linkedMoment.updatedAt = now;
    linkedMoment.storage = 'local';
    await uploadMomentRecordIfConnected(linkedMoment);
    persist();
  }
}

async function deleteMember(id) {
  return softDeleteRecord('members', 'members', id, 'สมาชิก');
}

async function toggleChecklist(index) {
  if (Number.isNaN(index) || index < 0 || index >= PACKING_ITEMS.length) return;
  const now = new Date().toISOString();
  state.checklist ||= { id: 'shared-checklist', type: 'checklist', items: {}, createdAt: now, storage: 'local' };
  state.checklist.items ||= {};
  state.checklist.items[index] = !state.checklist.items[index];
  state.checklist.updatedAt = now;
  state.checklist.createdAt ||= now;
  state.checklist.author = currentUserName();
  state.checklist.accountId = currentAccountId();
  state.checklist.storage = 'local';
  persist();
  await uploadRecordIfConnected('checklists', state.checklist);
  toast(state.checklist.items[index] ? `เช็กแล้ว: ${PACKING_ITEMS[index]}` : `ยกเลิกเช็ก: ${PACKING_ITEMS[index]}`);
  render();
}


async function toggleFeaturedMoment(momentId) {
  const moment = state.moments.find(item => item.id === momentId);
  if (!moment) return;
  moment.featured = !moment.featured;
  moment.updatedAt = new Date().toISOString();
  moment.storage = 'local';
  persist();
  await uploadMomentRecordIfConnected(moment);
  toast(moment.featured ? 'เก็บเข้า Vlog Studio แล้ว' : 'นำออกจาก Vlog Studio แล้ว');
  render();
}

async function fullSyncDrive() {
  state.settings.collectionSyncAt = {};
  persist();
  return syncDrive({ full: true, uploadPendingFirst: true });
}

async function reactToMoment(momentId, emoji) {
  const now = new Date().toISOString();
  const accountId = currentAccountId();
  const author = currentUserName();
  state.reactions ||= [];
  const existing = state.reactions.find(r => r.momentId === momentId && (r.accountId === accountId || (!r.accountId && r.author === author)));

  if (existing && existing.emoji === emoji) {
    // กด reaction เดิมซ้ำ = ยกเลิก reaction ของตัวเอง
    existing.emoji = '';
    existing.deleted = true;
    existing.updatedAt = now;
    existing.storage = 'local';
    persist();
    toast('ยกเลิก reaction แล้ว');
    await uploadRecordIfConnected('reactions', existing);
    render();
    return;
  }

  const reaction = existing || {
    id: `reaction_${momentId}_${accountId}`.replace(/[^a-zA-Z0-9_-]+/g, '-'),
    momentId,
    accountId,
    author,
    createdAt: now,
    storage: 'local'
  };
  reaction.emoji = emoji;
  reaction.deleted = false;
  reaction.author = author;
  reaction.accountId = accountId;
  reaction.updatedAt = now;
  reaction.storage = 'local';
  if (!existing) state.reactions.push(reaction);
  persist();
  toast(existing ? `เปลี่ยน reaction เป็น ${emoji}` : `React: ${emoji}`);
  await uploadRecordIfConnected('reactions', reaction);
  render();
}




async function autoConnectHub() {
  syncStatus = { text: 'กำลังเชื่อมต่อระบบอัตโนมัติ…', tone: 'info' };
  renderSyncStatusOnly();
  let ok = 0;
  try {
    if (state.settings.firebaseEnabled && state.settings.firebaseApiKey && state.settings.firebaseProjectId && state.settings.firebaseAppId) {
      await connectFirebase();
      ok += 1;
    }
  } catch (error) {
    console.warn('Auto Firebase connect failed:', error);
    state.settings.lastFirebaseError = error.message || String(error);
  }
  try {
    if (state.settings.driveClientId && state.settings.driveRootFolderId) {
      await connectDrive();
      ok += 1;
    }
  } catch (error) {
    console.warn('Auto Drive connect failed:', error);
    state.settings.lastDriveError = error.message || String(error);
  }
  try {
    if (firebase.connected) await uploadPendingSocialRecords({ silent: true });
    if (drive.connected) await uploadPendingMoments({ silent: true });
  } catch (error) {
    console.warn('Auto pending upload failed:', error);
  }
  syncStatus = ok ? { text: 'เชื่อมต่อและอัปเดตแล้ว', tone: 'success' } : { text: 'ยังเชื่อมต่อไม่ได้ ตรวจค่า Admin Hub หรือเปิดลิงก์เชิญใหม่', tone: 'error' };
  persist();
  toast(ok ? 'เชื่อมต่อและอัปเดตแล้ว' : 'ยังเชื่อมต่อไม่ได้');
  render();
}

function focusCommentInput(momentId) {
  const form = Array.from(document.querySelectorAll('form[data-form="comment"]')).find(item => item.dataset.momentId === momentId);
  const input = form?.querySelector('input');
  if (input) input.focus({ preventScroll: false });
}

function toggleCommentsView(momentId) {
  focusCommentInput(momentId);
}

async function connectFirebase() {
  await firebase.connect({ listen: true });
  state.settings.firebaseEnabled = true;
  state.settings.syncMode = 'firebase-first';
  state.settings.lastFirebaseError = '';
  persist();
  await uploadPendingSocialRecords({ silent: true });
  render();
}

async function uploadPendingSocialRecords(options = {}) {
  const { silent = false } = options;
  if (!state.settings.firebaseEnabled) {
    if (!silent) toast('เปิด Firebase ใน Settings ก่อน');
    return 0;
  }
  if (!firebase.connected) await firebase.connect({ listen: true });

  // ถ้าโมเมนต์มีไฟล์ pending ให้ส่งไฟล์ขึ้น Drive ก่อน เพื่อไม่ให้ Firestore เก็บไฟล์ใหญ่
  if (drive.connected && state.settings.driveRootFolderId) {
    for (const moment of state.moments.filter(m => (m.media || []).some(media => media.pendingUpload || media.localBlobId))) {
      try {
        const result = await uploadMomentWithStoredMedia(moment, { skipDriveRecord: true });
        Object.assign(moment, result, { storage: 'local' });
      } catch (error) {
        console.warn('Cannot upload media before Firebase sync:', error);
      }
    }
  }

  const data = {
    accounts: (state.accounts || []).filter(a => a.storage !== 'firebase'),
    tripSettings: (state.tripSettings || []).filter(t => t.storage !== 'firebase'),
    members: state.members.filter(m => m.storage !== 'firebase'),
    moments: state.moments.filter(m => m.storage !== 'firebase' && !(m.media || []).some(media => media.pendingUpload)),
    reactions: state.reactions.filter(r => r.storage !== 'firebase'),
    comments: (state.comments || []).filter(c => c.storage !== 'firebase'),
    votes: state.votes.filter(v => v.storage !== 'firebase'),
    quotes: state.quotes.filter(q => q.storage !== 'firebase'),
    expenses: state.expenses.filter(e => e.storage !== 'firebase'),
    quests: (state.questEvents || []).filter(q => q.storage !== 'firebase'),
    games: [state.bingo, state.secretBuddy].filter(item => item && item.storage !== 'firebase'),
    checklists: state.checklist?.updatedAt && state.checklist.storage !== 'firebase' ? [state.checklist] : []
  };
  const count = await firebase.uploadBatch(data);
  for (const records of Object.values(data)) for (const item of records) item.storage = 'firebase';
  persist();
  if (!silent) toast(count ? `ส่งข้อมูลที่รออยู่ ${count} รายการแล้ว` : 'ไม่มี Pending สำหรับ Firebase');
  render();
  return count;
}

async function connectDrive() {
  await drive.authorize({ prompt: 'consent' });
  if (state.settings.driveRootFolderId) await drive.ensureStructure();
  persist();
  startSyncLoop();
  await syncDrive({ silent: true, uploadPendingFirst: true });
  if (isAdminAccount() && state.settings.firebaseEnabled && firebase.connected) await publishAdminDriveSettings();
  render();
}

async function createDriveFolder() {
  if (!requireAdmin('เฉพาะ Admin เท่านั้นที่สร้างโฟลเดอร์รูปทริปได้')) return;
  await drive.authorize({ prompt: drive.connected ? '' : 'consent' });
  const folder = await drive.createTripFolder(state.settings.driveRootFolderName);
  toast(`สร้างโฟลเดอร์แล้ว: ${folder.name}`);
  startSyncLoop();
  await uploadPendingMoments({ silent: true });
  if (isAdminAccount() && state.settings.firebaseEnabled && firebase.connected) await publishAdminDriveSettings();
  render();
}

async function syncDrive(options = {}) {
  const { silent = false, uploadPendingFirst = false, full = false } = options;
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
    const shared = await drive.listSharedData({ full });
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
  for (const comment of (state.comments || []).filter(c => c.storage !== 'drive')) {
    await uploadRecordIfConnected('comments', comment, { force: true }); uploaded += 1;
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
  if (state.secretBuddy && state.secretBuddy.storage !== 'drive') {
    await uploadRecordIfConnected('games', state.secretBuddy, { force: true }); uploaded += 1;
  }
  if (state.checklist?.updatedAt && state.checklist.storage !== 'drive') {
    await uploadRecordIfConnected('checklists', state.checklist, { force: true }); uploaded += 1;
  }

  persist();
  if (!silent) toast(uploaded ? `ส่ง Pending เข้า Drive Hub ${uploaded} รายการแล้ว` : 'ไม่มี Pending ที่ต้องอัปโหลด');
  render();
  return uploaded;
}

async function uploadRecordIfConnected(collection, item, options = {}) {
  const force = Boolean(options.force);
  const now = new Date().toISOString();
  item.updatedAt ||= now;

  if (state.settings.firebaseEnabled && (firebase.connected || force)) {
    try {
      if (!firebase.connected) await firebase.connect({ listen: true });
      await firebase.uploadRecord(collection, item);
      item.storage = 'firebase';
      item.syncedAt = now;
      persist();
      return true;
    } catch (error) {
      console.warn('Firebase upload pending kept local', collection, item, error);
      state.settings.lastFirebaseError = error.message || String(error);
      item.storage = item.storage || 'local';
      persist();
      if (!drive.connected && !state.settings.driveRootFolderId) return false;
    }
  }

  if ((!drive.connected || !state.settings.driveRootFolderId) && !force) return false;
  try {
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
  moment.uploadState ||= (moment.media || []).length ? 'pending' : 'local';
  try {
    if ((moment.media || []).length && drive.connected && state.settings.driveRootFolderId) {
      const result = await uploadMomentWithStoredMedia(moment, { skipDriveRecord: state.settings.firebaseEnabled && firebase.connected });
      Object.assign(moment, result);
    }

    const hasPendingMedia = (moment.media || []).some(media => media.pendingUpload || (!media.driveFileId && !media.webViewLink && media.localBlobId));
    if (state.settings.firebaseEnabled && firebase.connected && !hasPendingMedia) {
      await firebase.uploadRecord('moments', moment);
      moment.storage = 'firebase';
      moment.uploadState = 'synced';
      moment.uploadMessage = 'ซิงก์สำเร็จ';
      persist();
      return true;
    }

    if (drive.connected && state.settings.driveRootFolderId) {
      const result = (moment.media || []).length ? await uploadMomentWithStoredMedia(moment) : (await drive.uploadMoment(moment)).moment;
      Object.assign(moment, result, { storage: 'drive', uploadState: 'synced', uploadMessage: 'ซิงก์สำเร็จ' });
      persist();
      return true;
    }
  } catch (error) {
    console.warn('Moment upload pending kept local', moment, error);
  }
  moment.storage = 'local';
  if ((moment.media || []).some(media => media.pendingUpload || (!media.driveFileId && media.localBlobId))) {
    moment.uploadState = moment.uploadState === 'uploading' ? 'pending' : (moment.uploadState || 'pending');
    moment.uploadMessage = 'รอเชื่อมต่อ Hub เพื่อส่งไฟล์เต็ม';
  }
  return false;
}


function applyTripProfile(record = {}) {
  if (!record || record.id !== 'trip-profile') return false;
  state.trip ||= {};
  const fields = ['title', 'subtitle', 'destination', 'day', 'mood', 'nextPlan'];
  let changed = false;
  for (const key of fields) {
    if (record[key] !== undefined && state.trip[key] !== record[key]) {
      state.trip[key] = record[key];
      changed = true;
    }
  }
  return changed;
}

function applyFirebaseData(shared = {}) {
  mergeRemote('accounts', shared.accounts || [], 'firebase');
  mergeRemote('tripSettings', shared.tripSettings || [], 'firebase');
  const tripProfile = (state.tripSettings || []).find(x => x.id === 'trip-profile');
  if (tripProfile) applyTripProfile(tripProfile);
  const adminDrive = (state.tripSettings || []).find(x => x.id === 'admin-drive-hub');
  if (state.settings.driveManagedByAdmin !== false && adminDrive) {
    const driveChanged = applyAdminDriveSettings(adminDrive);
    if (driveChanged && state.settings.autoSyncOnStart) setTimeout(() => autoConnectDriveOnStart(), 250);
  }
  mergeRemote('members', shared.members || [], 'firebase');
  mergeRemote('moments', shared.moments || [], 'firebase');
  mergeRemote('reactions', shared.reactions || [], 'firebase');
  mergeRemote('comments', shared.comments || [], 'firebase');
  mergeRemote('votes', shared.votes || [], 'firebase');
  mergeRemote('quotes', shared.quotes || [], 'firebase');
  mergeRemote('expenses', shared.expenses || [], 'firebase');
  mergeQuestEvents(shared.quests || [], 'firebase');
  mergeGameRecords(shared.games || [], 'firebase');
  mergeChecklistRecords(shared.checklists || [], 'firebase');
  state.settings.lastFirebaseError = '';
  persist();
  if (!document.hidden) render();
}

function applyDriveData(shared = {}) {
  mergeRemote('accounts', shared.accounts || [], 'drive');
  mergeRemote('tripSettings', shared.tripSettings || [], 'drive');
  const tripProfile = (state.tripSettings || []).find(x => x.id === 'trip-profile');
  if (tripProfile) applyTripProfile(tripProfile);
  mergeRemote('members', shared.members || [], 'drive');
  mergeRemote('moments', shared.moments || [], 'drive');
  mergeRemote('reactions', shared.reactions || [], 'drive');
  mergeRemote('comments', shared.comments || [], 'drive');
  mergeRemote('votes', shared.votes || [], 'drive');
  mergeRemote('quotes', shared.quotes || [], 'drive');
  mergeRemote('expenses', shared.expenses || [], 'drive');
  mergeQuestEvents(shared.quests || [], 'drive');
  mergeGameRecords(shared.games || [], 'drive');
  mergeChecklistRecords(shared.checklists || [], 'drive');
}

function mergeRemote(key, remoteItems, source = 'drive') {
  const map = new Map((state[key] || []).map(item => [item.id, item]));
  for (const remote of remoteItems || []) {
    if (!remote?.id) continue;
    const local = map.get(remote.id);
    if (!local) {
      map.set(remote.id, { ...remote, storage: remote.storage || source });
      continue;
    }
    const localTime = new Date(local.updatedAt || local.createdAt || 0).getTime();
    const remoteTime = new Date(remote.updatedAt || remote._driveModifiedTime || remote.createdAt || 0).getTime();
    if (remoteTime >= localTime || local.storage === 'drive') {
      const merged = { ...local, ...remote, storage: remote.storage || source };
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

function mergeQuestEvents(remoteItems = [], source = 'drive') {
  state.questEvents ||= [];
  mergeRemote('questEvents', remoteItems, source);
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

function mergeGameRecords(records = [], source = 'drive') {
  const bingos = records.filter(r => r.type === 'bingo' && r.cells?.length);
  if (bingos.length) {
    bingos.sort((a, b) => new Date(a.updatedAt || a.createdAt || 0) - new Date(b.updatedAt || b.createdAt || 0));
    const latest = bingos.at(-1);
    const localTime = new Date(state.bingo?.updatedAt || state.bingo?.createdAt || 0).getTime();
    const remoteTime = new Date(latest.updatedAt || latest.createdAt || 0).getTime();
    if (!state.bingo || remoteTime >= localTime || state.bingo.storage === 'drive') {
      state.bingo = { ...latest, storage: latest.storage || source };
    }
  }
  const secretRecords = records.filter(r => r.type === 'secretBuddy');
  if (secretRecords.length) {
    secretRecords.sort((a, b) => new Date(a.updatedAt || a.createdAt || 0) - new Date(b.updatedAt || b.createdAt || 0));
    const latestSecret = secretRecords.at(-1);
    const localTime = new Date(state.secretBuddy?.updatedAt || state.secretBuddy?.createdAt || 0).getTime();
    const remoteTime = new Date(latestSecret.updatedAt || latestSecret.createdAt || 0).getTime();
    if (latestSecret.completed) {
      if (remoteTime >= localTime) state.secretBuddy = null;
    } else if (!state.secretBuddy || remoteTime >= localTime || state.secretBuddy.storage === 'drive') {
      state.secretBuddy = { ...latestSecret, storage: latestSecret.storage || source };
    }
  }
}

function mergeChecklistRecords(records = [], source = 'drive') {
  const checklists = records.filter(r => r.type === 'checklist' || r.id === 'shared-checklist');
  if (!checklists.length) return;
  checklists.sort((a, b) => new Date(a.updatedAt || a.createdAt || 0) - new Date(b.updatedAt || b.createdAt || 0));
  const latest = checklists.at(-1);
  const localTime = new Date(state.checklist?.updatedAt || state.checklist?.createdAt || 0).getTime();
  const remoteTime = new Date(latest.updatedAt || latest.createdAt || 0).getTime();
  if (!state.checklist || remoteTime >= localTime || state.checklist.storage === 'drive') {
    state.checklist = { ...latest, items: latest.items || {}, storage: latest.storage || source };
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
  const moment = activeList('moments').find(item => item.id === momentId);
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
  const moment = activeList('moments').find(item => item.id === momentId);
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
  if (!confirm('ล้างข้อมูล Local ในเครื่องนี้? ข้อมูลบน Firebase/Google Drive จะไม่ถูกลบ')) return;
  ['kannajaburi-trip-state-v10','kannajaburi-trip-state-v9','kannajaburi-trip-state-v8','kannajaburi-trip-state-v7','kannajaburi-trip-state-v6','kannajaburi-trip-state-v5','kannajaburi-trip-state-v4','kannajaburi-trip-state-v3', ACCOUNT_SESSION_KEY].forEach(key => localStorage.removeItem(key));
  state = loadState();
  state.accountModalOpen = false;
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
  const activeMembers = activeList('members');
  const options = activeMembers.length ? activeMembers : [{ name: state.profile.name || 'แก๊งนี้' }];
  return `<select class="select" name="${escapeAttr(name)}">${options.map(m => `<option value="${escapeAttr(m.name)}" ${selected === m.name ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}</select>`;
}

function uniqueActiveReactions(reactions = []) {
  const byUser = new Map();
  for (const r of reactions || []) {
    const key = r.accountId || r.author || r.id;
    const old = byUser.get(key);
    const time = new Date(r.updatedAt || r.createdAt || 0).getTime();
    const oldTime = old ? new Date(old.updatedAt || old.createdAt || 0).getTime() : -1;
    if (time >= oldTime) byUser.set(key, r);
  }
  return [...byUser.values()].filter(r => r.emoji && !r.deleted);
}

function reactionSummary(reactions) {
  const active = uniqueActiveReactions(reactions);
  if (!active.length) return '';
  const counts = active.reduce((acc, r) => { acc[r.emoji] = (acc[r.emoji] || 0) + 1; return acc; }, {});
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

function safeTripId(value = '') {
  return String(value || 'kannajaburi-trip')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'kannajaburi-trip';
}
