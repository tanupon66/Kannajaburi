import { dataUrlToBlob, uid } from './state.js';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

export const DRIVE_COLLECTIONS = [
  'members',
  'moments',
  'media',
  'reactions',
  'votes',
  'quotes',
  'expenses',
  'quests',
  'games',
  'meta'
];

export class DriveSync {
  constructor({ getState, saveState, toast, onStatus }) {
    this.getState = getState;
    this.saveState = saveState;
    this.toast = toast;
    this.onStatus = onStatus;
    this.tokenClient = null;
    this.accessToken = '';
    this.mediaCache = new Map();
    this.gisReady = false;
    this.lastError = '';
  }

  get config() {
    return this.getState().settings;
  }

  get connected() {
    return Boolean(this.accessToken);
  }

  status(message, tone = 'info') {
    this.onStatus?.(message, tone);
  }

  async loadGis() {
    if (window.google?.accounts?.oauth2) return true;
    if (this.gisReady) return true;
    await new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-gis]');
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.dataset.gis = '1';
      script.onload = resolve;
      script.onerror = () => reject(new Error('โหลด Google Identity Services ไม่สำเร็จ'));
      document.head.appendChild(script);
    });
    this.gisReady = true;
    return true;
  }

  async authorize({ prompt = '' } = {}) {
    const clientId = this.config.driveClientId?.trim();
    if (!clientId) throw new Error('กรุณาใส่ Google OAuth Client ID ก่อน');
    await this.loadGis();
    this.status(prompt ? 'กำลังขอสิทธิ์ Google Drive…' : 'กำลังเชื่อมต่อ Google Drive…');
    return new Promise((resolve, reject) => {
      this.tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_SCOPE,
        callback: (response) => {
          if (response.error) {
            this.lastError = response.error;
            return reject(new Error(response.error));
          }
          this.accessToken = response.access_token;
          this.lastError = '';
          this.status('Drive connected', 'success');
          this.toast?.('เชื่อมต่อ Google Drive แล้ว');
          resolve(response.access_token);
        }
      });
      this.tokenClient.requestAccessToken({ prompt });
    });
  }

  async ensureAuthorized() {
    if (this.accessToken) return this.accessToken;
    return this.authorize({ prompt: '' });
  }

  async request(url, options = {}, retry = true) {
    await this.ensureAuthorized();
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...(options.headers || {})
      }
    });
    if (response.status === 401 && retry) {
      this.accessToken = '';
      await this.authorize({ prompt: '' });
      return this.request(url, options, false);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      this.lastError = text || response.statusText;
      throw new Error(`Google Drive error ${response.status}: ${text || response.statusText}`);
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) return response.json();
    return response;
  }

  async createTripFolder(name = this.config.driveRootFolderName) {
    await this.ensureAuthorized();
    const root = await this.createFolder(name || 'กาญนะจ๊ะบุรีทริป - Shared Memories', null);
    const state = this.getState();
    state.settings.driveRootFolderId = root.id;
    state.settings.driveRootFolderName = root.name;
    state.settings.driveChildren = {};
    this.saveState();
    await this.ensureStructure();
    await this.uploadRecord('meta', {
      id: 'trip-manifest',
      app: 'กาญนะจ๊ะบุรีทริป',
      version: '1.3.0',
      mode: 'drive-first',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      note: 'Shared Drive hub for Kannajaburi Trip PWA. Share the root folder with friends as Editor.'
    });
    return root;
  }

  async ensureStructure() {
    const state = this.getState();
    const rootId = state.settings.driveRootFolderId?.trim();
    if (!rootId) throw new Error('ยังไม่มี Drive Folder ID ของทริป');
    state.settings.driveChildren ||= {};
    for (const name of DRIVE_COLLECTIONS) {
      if (state.settings.driveChildren[name]) continue;
      const found = await this.findFolder(name, rootId);
      const folder = found || await this.createFolder(name, rootId);
      state.settings.driveChildren[name] = folder.id;
      this.saveState();
    }
    return state.settings.driveChildren;
  }

  async findFolder(name, parentId) {
    const q = [
      `name = '${escapeQ(name)}'`,
      `mimeType = 'application/vnd.google-apps.folder'`,
      `trashed = false`,
      parentId ? `'${escapeQ(parentId)}' in parents` : null
    ].filter(Boolean).join(' and ');
    const url = `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,webViewLink)&pageSize=1`;
    const data = await this.request(url);
    return data.files?.[0] || null;
  }

  async createFolder(name, parentId) {
    const body = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {})
    };
    return this.request(`${DRIVE_API}/files?fields=id,name,webViewLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  async uploadJson(folderId, name, data) {
    const file = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    return this.uploadBlob(folderId, file, name, 'application/json');
  }

  async uploadRecord(collection, item) {
    const children = await this.ensureStructure();
    const folderId = children[collection];
    if (!folderId) throw new Error(`Drive collection not found: ${collection}`);
    const record = {
      ...structuredClone(item),
      id: item.id || uid(collection),
      collection,
      updatedAt: item.updatedAt || new Date().toISOString(),
      storage: 'drive'
    };
    return this.uploadJson(folderId, `${safeName(record.id)}-${Date.now().toString(36)}.json`, record);
  }

  async uploadDataUrl(folderId, dataUrl, name = `${uid('media')}.jpg`) {
    const blob = dataUrlToBlob(dataUrl);
    return this.uploadBlob(folderId, blob, name, blob.type || 'image/jpeg');
  }

  async uploadBlob(folderId, blob, name, mimeType = blob.type || 'application/octet-stream') {
    await this.ensureAuthorized();
    const metadata = { name, mimeType, parents: [folderId] };
    const boundary = `kannajaburi_${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;
    const multipart = new Blob([
      delimiter,
      'Content-Type: application/json; charset=UTF-8\r\n\r\n',
      JSON.stringify(metadata),
      delimiter,
      `Content-Type: ${mimeType}\r\n\r\n`,
      blob,
      closeDelimiter
    ], { type: `multipart/related; boundary=${boundary}` });

    return this.request(`${DRIVE_UPLOAD}?uploadType=multipart&fields=id,name,mimeType,webViewLink,thumbnailLink,createdTime,modifiedTime`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipart
    });
  }

  async uploadMoment(moment) {
    const children = await this.ensureStructure();
    const uploadable = structuredClone(moment);
    uploadable.id ||= uid('moment');
    uploadable.updatedAt = new Date().toISOString();
    uploadable.syncedAt = uploadable.updatedAt;
    uploadable.storage = 'drive';

    if (uploadable.media?.[0]?.localDataUrl && !uploadable.media[0].driveFileId) {
      const ext = uploadable.media[0].mimeType?.includes('png') ? 'png' : uploadable.media[0].mimeType?.includes('video') ? 'mp4' : 'jpg';
      const mediaFile = await this.uploadDataUrl(children.media, uploadable.media[0].localDataUrl, `${uploadable.id}.${ext}`);
      uploadable.media[0] = {
        driveFileId: mediaFile.id,
        name: mediaFile.name,
        mimeType: mediaFile.mimeType,
        webViewLink: mediaFile.webViewLink,
        thumbnailLink: mediaFile.thumbnailLink
      };
    }
    const jsonFile = await this.uploadRecord('moments', uploadable);
    return { moment: uploadable, file: jsonFile };
  }

  async uploadReaction(reaction) {
    return this.uploadRecord('reactions', reaction);
  }

  async listSharedData({ collections = DRIVE_COLLECTIONS.filter(x => x !== 'media') } = {}) {
    await this.ensureStructure();
    const result = {};
    for (const collection of collections) {
      if (collection === 'media') continue;
      result[collection] = await this.listCollection(collection);
    }
    const state = this.getState();
    state.settings.lastSyncAt = new Date().toISOString();
    this.saveState();
    return result;
  }

  async listCollection(collection) {
    const children = await this.ensureStructure();
    const folderId = children[collection];
    if (!folderId) return [];
    return this.listJsonFiles(folderId);
  }

  async listJsonFiles(folderId) {
    const q = [`'${escapeQ(folderId)}' in parents`, `mimeType = 'application/json'`, `trashed = false`].join(' and ');
    let pageToken = '';
    const files = [];
    do {
      const url = `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name,createdTime,modifiedTime)&orderBy=modifiedTime desc&pageSize=100${pageToken ? `&pageToken=${pageToken}` : ''}`;
      const data = await this.request(url);
      files.push(...(data.files || []));
      pageToken = data.nextPageToken || '';
    } while (pageToken);

    const parsed = [];
    for (const file of files) {
      try {
        const response = await this.request(`${DRIVE_API}/files/${file.id}?alt=media`);
        const json = await response.json();
        parsed.push({ ...json, _driveJsonFileId: file.id, _driveModifiedTime: file.modifiedTime });
      } catch (error) {
        console.warn('Cannot parse Drive JSON', file, error);
      }
    }
    return parsed;
  }

  async mediaUrl(fileId) {
    if (!fileId) return '';
    if (this.mediaCache.has(fileId)) return this.mediaCache.get(fileId);
    const response = await this.request(`${DRIVE_API}/files/${fileId}?alt=media`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    this.mediaCache.set(fileId, url);
    return url;
  }
}

function escapeQ(value = '') {
  return String(value).replace(/'/g, "\\'");
}

function safeName(value = '') {
  return String(value).replace(/[^a-zA-Z0-9_\-.ก-๙]/g, '_').slice(0, 90) || 'record';
}
