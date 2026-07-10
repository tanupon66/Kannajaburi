export const STORAGE_KEY = 'kannajaburi-trip-state-v15';
export const LEGACY_STORAGE_KEY = 'kannajaburi-trip-state-v14';
export const OLD_STORAGE_KEYS = ['kannajaburi-trip-state-v13','kannajaburi-trip-state-v12','kannajaburi-trip-state-v11','kannajaburi-trip-state-v10','kannajaburi-trip-state-v9','kannajaburi-trip-state-v8','kannajaburi-trip-state-v7','kannajaburi-trip-state-v6'];

export const DEFAULT_STATE = {
  schema: 15,
  appName: 'กาญนะจ๊ะบุรีทริป',
  trip: {
    title: 'กาญนะจ๊ะบุรีทริป',
    subtitle: 'เที่ยวให้สุด เล่นให้ยับ เก็บความทรงจำให้ครบ',
    destination: 'กาญจนบุรี',
    day: 'Day 1 — เขื่อนเขาแหลม / คืนแพ',
    mood: 'คืนนี้ต้องมีตำนาน',
    nextPlan: 'เพิ่มแผนวันนี้ เช่น ออกเดินทาง / เช็กอิน / เล่นเกม / Vlog Night'
  },
  profile: {
    accountId: '',
    name: '',
    role: 'สายคอนเทนต์',
    color: '#0f6b5e',
    avatarDataUrl: '',
    avatarMimeType: '',
    avatarName: '',
    isAdmin: false,
    pinHint: '',
    createdAt: ''
  },
  auth: {
    activeAccountId: '',
    lastLoginAt: '',
    loginRequired: true
  },
  members: [],
  accounts: [],
  tripSettings: [],
  moments: [],
  reactions: [],
  comments: [],
  questsDone: {},
  questEvents: [],
  bingo: null,
  secretBuddy: null,
  checklist: { id: 'shared-checklist', type: 'checklist', items: {}, createdAt: '', updatedAt: '', storage: 'local' },
  votes: [],
  quotes: [],
  expenses: [],
  settings: {
    driveClientId: '',
    driveRootFolderId: '',
    driveRootFolderName: 'กาญนะจ๊ะบุรีทริป - Shared Memories',
    driveChildren: {},
    lastSyncAt: '',
    syncMode: 'firebase-first',
    autoSyncOnStart: true,
    liveSyncEnabled: true,
    syncIntervalSec: 20,
    useIncrementalSync: true,
    collectionSyncAt: {},
    socialLiveMode: true,
    lastDriveError: '',
    firebaseEnabled: false,
    firebaseTripId: 'kannajaburi-trip',
    firebaseApiKey: '',
    firebaseAuthDomain: '',
    firebaseProjectId: '',
    firebaseStorageBucket: '',
    firebaseMessagingSenderId: '',
    firebaseAppId: '',
    lastFirebaseError: '',
    installPromptDismissed: false,
    adminDriveOwner: '',
    adminDriveSharedAt: '',
    driveManagedByAdmin: true,
    driveConsentGranted: false,
    driveSessionRemember: true
  }
};

export function uid(prefix = 'id') {
  const rand = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}_${Date.now().toString(36)}_${rand[0].toString(36)}${rand[1].toString(36)}`;
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY) || OLD_STORAGE_KEYS.map(key => localStorage.getItem(key)).find(Boolean);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const data = sanitizePersistedState(JSON.parse(raw));
    return mergeDefaults(structuredClone(DEFAULT_STATE), data);
  } catch (error) {
    console.warn('Cannot load state:', error);
    return structuredClone(DEFAULT_STATE);
  }
}

export function saveState(state) {
  try {
    const clean = sanitizePersistedState(structuredClone(state));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    return true;
  } catch (error) {
    console.error('Cannot save state:', error);
    return false;
  }
}

export function exportState(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `kannajaburi-trip-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

export function importState(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        resolve(mergeDefaults(structuredClone(DEFAULT_STATE), data));
      } catch (error) {
        reject(error);
      }
    };
    reader.readAsText(file, 'utf-8');
  });
}


function sanitizePersistedState(data) {
  if (!data || typeof data !== 'object') return data;
  // Runtime-only UI flags must not be restored after refresh.
  // v1.7.0 saved accountModalOpen=true in some cases, causing the app to ask users to enter their account again after every refresh.
  delete data.accountModalOpen;
  delete data.composerModalOpen;
  delete data.modalOpen;
  delete data.reelOpen;
  return data;
}

function mergeDefaults(base, data) {
  if (!data || typeof data !== 'object') return base;
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      base[key] = mergeDefaults(base[key], value);
    } else {
      base[key] = value;
    }
  }
  return base;
}

export async function fileToOptimizedDataUrl(file, maxSize = 1600, quality = 0.78) {
  if (!file || !file.type.startsWith('image/')) {
    return fileToDataUrl(file);
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve('');
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

export function dataUrlToBlob(dataUrl) {
  const [meta, base64] = dataUrl.split(',');
  const mime = meta.match(/:(.*?);/)?.[1] || 'application/octet-stream';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function formatThaiDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

export function scoreFromState(state) {
  const questScore = Object.keys(state.questsDone || {}).length * 15;
  const momentScore = (state.moments || []).filter(item => !item.deleted).length * 10;
  const quoteScore = (state.quotes || []).filter(item => !item.deleted).length * 5;
  const voteScore = (state.votes || []).filter(item => !item.deleted).length * 8;
  return questScore + momentScore + quoteScore + voteScore;
}

export function initials(name = '?') {
  return name.trim().split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase() || '?';
}
