const FIREBASE_VERSION = '10.12.5';
const COLLECTIONS = ['accounts', 'members', 'moments', 'reactions', 'comments', 'votes', 'quotes', 'expenses', 'quests', 'games', 'checklists', 'tripSettings'];

export class FirebaseHub {
  constructor({ getState, saveState, toast, onStatus, onData }) {
    this.getState = getState;
    this.saveState = saveState;
    this.toast = toast;
    this.onStatus = onStatus;
    this.onData = onData;
    this.app = null;
    this.db = null;
    this.auth = null;
    this.user = null;
    this.connected = false;
    this.unsubscribers = [];
    this.modules = null;
    this.lastError = '';
  }

  get settings() {
    return this.getState().settings || {};
  }

  get tripId() {
    return safeTripId(this.settings.firebaseTripId || 'kannajaburi-trip');
  }

  status(message, tone = 'info') {
    this.onStatus?.(message, tone);
  }

  async loadModules() {
    if (this.modules) return this.modules;
    const [appMod, firestoreMod, authMod] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`)
    ]);
    this.modules = { ...appMod, ...firestoreMod, ...authMod };
    return this.modules;
  }

  readConfig() {
    const s = this.settings;
    const config = {
      apiKey: (s.firebaseApiKey || '').trim(),
      authDomain: (s.firebaseAuthDomain || '').trim(),
      projectId: (s.firebaseProjectId || '').trim(),
      appId: (s.firebaseAppId || '').trim(),
      storageBucket: (s.firebaseStorageBucket || '').trim() || undefined,
      messagingSenderId: (s.firebaseMessagingSenderId || '').trim() || undefined
    };
    if (!config.apiKey || !config.authDomain || !config.projectId || !config.appId) {
      throw new Error('กรุณาใส่ Firebase config ให้ครบ: apiKey, authDomain, projectId และ appId');
    }
    return config;
  }

  async connect({ listen = true } = {}) {
    const config = this.readConfig();
    const mod = await this.loadModules();
    this.status('กำลังเชื่อม Firebase Live Feed…');
    this.app = this.app || mod.initializeApp(config, 'kannajaburi-trip-app');
    this.db = this.db || mod.getFirestore(this.app);
    this.auth = this.auth || mod.getAuth(this.app);

    try {
      await mod.setPersistence(this.auth, mod.browserLocalPersistence);
    } catch (error) {
      console.warn('Firebase auth local persistence unavailable:', error);
    }

    if (!this.auth.currentUser) {
      const credential = await mod.signInAnonymously(this.auth);
      this.user = credential.user;
    } else {
      this.user = this.auth.currentUser;
    }

    this.connected = true;
    this.lastError = '';
    this.status('Firebase connected · realtime feed on', 'success');
    this.toast?.('เชื่อมต่อ Firebase Live Feed แล้ว');
    if (listen) this.startListeners();
    return true;
  }

  stopListeners() {
    for (const unsub of this.unsubscribers) {
      try { unsub(); } catch (error) { console.warn(error); }
    }
    this.unsubscribers = [];
  }

  async startListeners() {
    if (!this.connected || !this.db) await this.connect({ listen: false });
    const mod = await this.loadModules();
    this.stopListeners();
    const live = {};
    for (const name of COLLECTIONS) live[name] = [];

    for (const name of COLLECTIONS) {
      const colRef = this.collectionRef(name);
      const q = mod.query(colRef, mod.orderBy('updatedAt', 'desc'), mod.limit(250));
      const unsub = mod.onSnapshot(q, snapshot => {
        live[name] = snapshot.docs.map(docSnap => ({
          id: docSnap.id,
          ...docSnap.data(),
          storage: 'firebase',
          _firebasePath: docSnap.ref.path
        }));
        this.onData?.(structuredClone(live));
        this.status(`Live Feed · ${name} updated`, 'success');
      }, error => {
        this.lastError = error.message || String(error);
        this.status('Firebase realtime listener error', 'error');
        console.warn('Firebase listener error:', name, error);
      });
      this.unsubscribers.push(unsub);
    }
  }

  collectionRef(collectionName) {
    const mod = this.modules;
    return mod.collection(this.db, 'trips', this.tripId, collectionName);
  }

  docRef(collectionName, id) {
    const mod = this.modules;
    return mod.doc(this.db, 'trips', this.tripId, collectionName, id);
  }

  async uploadRecord(collectionName, item) {
    if (!this.connected || !this.db) await this.connect({ listen: false });
    const mod = await this.loadModules();
    const now = new Date().toISOString();
    const clean = cleanForFirestore({
      ...structuredClone(item),
      id: item.id,
      collection: collectionName,
      tripId: this.tripId,
      updatedAt: item.updatedAt || now,
      createdAt: item.createdAt || now,
      storage: 'firebase'
    });
    await mod.setDoc(this.docRef(collectionName, clean.id), clean, { merge: true });
    item.storage = 'firebase';
    item.syncedAt = now;
    return clean;
  }

  async uploadBatch(recordsByCollection = {}) {
    if (!this.connected || !this.db) await this.connect({ listen: false });
    const mod = await this.loadModules();
    const batch = mod.writeBatch(this.db);
    let count = 0;
    for (const [collectionName, records] of Object.entries(recordsByCollection)) {
      for (const item of records || []) {
        if (!item?.id) continue;
        const now = new Date().toISOString();
        const clean = cleanForFirestore({
          ...structuredClone(item),
          collection: collectionName,
          tripId: this.tripId,
          updatedAt: item.updatedAt || now,
          createdAt: item.createdAt || now,
          storage: 'firebase'
        });
        batch.set(this.docRef(collectionName, clean.id), clean, { merge: true });
        count += 1;
      }
    }
    if (count) await batch.commit();
    return count;
  }
}

function safeTripId(value = '') {
  return String(value || 'kannajaburi-trip')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'kannajaburi-trip';
}

function cleanForFirestore(value) {
  if (Array.isArray(value)) return value.map(cleanForFirestore).filter(v => v !== undefined);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (val === undefined || typeof val === 'function') continue;
      if (key === 'localDataUrl' || key === 'localBlobId') continue;
      out[key] = cleanForFirestore(val);
    }
    return out;
  }
  return value;
}
