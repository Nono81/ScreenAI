// ============================================
// ScreenAI — Storage Layer
// ============================================

import type { Conversation, Project, AppSettings, Message } from '../types';
import { DEFAULT_SETTINGS, generateId } from '../types';

const DB_NAME = 'screenai';
const DB_VERSION = 2;
const STORE_CONVERSATIONS = 'conversations';
const STORE_PROJECTS = 'projects';

// ============================================
// IndexedDB Manager
// ============================================
class Database {
  private db: IDBDatabase | null = null;

  async open(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_CONVERSATIONS)) {
          const s = db.createObjectStore(STORE_CONVERSATIONS, { keyPath: 'id' });
          s.createIndex('updatedAt', 'updatedAt', { unique: false });
          s.createIndex('projectId', 'projectId', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
          const s = db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
          s.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };
      req.onsuccess = () => { this.db = req.result; resolve(this.db); };
      req.onerror = () => reject(req.error);
    });
  }

  async getAll<T>(store: string): Promise<T[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).index('updatedAt').getAll();
      req.onsuccess = () => resolve((req.result as T[]).reverse());
      req.onerror = () => reject(req.error);
    });
  }

  async get<T>(store: string, id: string): Promise<T | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async put<T>(store: string, item: T): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async del(store: string, id: string): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

const db = new Database();

// ============================================
// Projects
// ============================================
export const projectStore = {
  getAll: () => db.getAll<Project>(STORE_PROJECTS),
  get: (id: string) => db.get<Project>(STORE_PROJECTS, id),

  async create(data: { name: string; description?: string; instructions?: string; provider?: string; model?: string }): Promise<Project> {
    const p: Project = {
      id: generateId(), name: data.name, description: data.description || '',
      instructions: data.instructions || '', provider: (data.provider || 'claude') as any,
      model: data.model || 'claude-sonnet-4-20250514',
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    await db.put(STORE_PROJECTS, p);
    return p;
  },

  async update(id: string, updates: Partial<Project>): Promise<Project> {
    const p = await this.get(id);
    if (!p) throw new Error(`Project ${id} not found`);
    const updated = { ...p, ...updates, updatedAt: Date.now() };
    await db.put(STORE_PROJECTS, updated);
    return updated;
  },

  async delete(id: string): Promise<void> {
    const convos = await conversationStore.getByProject(id);
    for (const c of convos) await db.del(STORE_CONVERSATIONS, c.id);
    await db.del(STORE_PROJECTS, id);
  },
};

// ============================================
// Conversations
// ============================================
export const conversationStore = {
  getAll: () => db.getAll<Conversation>(STORE_CONVERSATIONS),

  async getStandalone(): Promise<Conversation[]> {
    return (await this.getAll()).filter(c => !c.projectId);
  },

  async getByProject(projectId: string): Promise<Conversation[]> {
    return (await this.getAll()).filter(c => c.projectId === projectId);
  },

  get: (id: string) => db.get<Conversation>(STORE_CONVERSATIONS, id),

  async create(provider: string, model: string, projectId?: string): Promise<Conversation> {
    const c: Conversation = {
      id: generateId(), title: 'New conversation', messages: [],
      provider: provider as any, model, projectId,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    await db.put(STORE_CONVERSATIONS, c);
    return c;
  },

  async addMessage(id: string, msg: Message): Promise<Conversation> {
    const c = await this.get(id);
    if (!c) throw new Error(`Conversation ${id} not found`);
    c.messages.push(msg);
    c.updatedAt = Date.now();
    if (c.messages.filter(m => m.role === 'user').length === 1 && msg.role === 'user' && msg.content) {
      c.title = msg.content.slice(0, 60) + (msg.content.length > 60 ? '…' : '');
    }
    await db.put(STORE_CONVERSATIONS, c);
    return c;
  },

  async update(id: string, updates: Partial<Conversation>): Promise<Conversation> {
    const c = await this.get(id);
    if (!c) throw new Error(`Conversation ${id} not found`);
    const updated = { ...c, ...updates, updatedAt: Date.now() };
    await db.put(STORE_CONVERSATIONS, updated);
    return updated;
  },

  delete: (id: string) => db.del(STORE_CONVERSATIONS, id),

  async search(query: string): Promise<Conversation[]> {
    const q = query.toLowerCase();
    return (await this.getAll()).filter(c =>
      c.title.toLowerCase().includes(q) ||
      c.messages.some(m => m.content?.toLowerCase().includes(q))
    );
  },
};

// ============================================
// Settings
// ============================================
export const settingsStore = {
  key: 'screenai_settings',
  async get(): Promise<AppSettings> {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        return new Promise(r => chrome.storage.local.get(this.key, (res: any) => r(res[this.key] || { ...DEFAULT_SETTINGS })));
      }
    } catch {}
    const raw = localStorage.getItem(this.key);
    if (raw) try { return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }; } catch {}
    return { ...DEFAULT_SETTINGS };
  },
  async save(s: AppSettings): Promise<void> {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        return new Promise(r => chrome.storage.local.set({ [this.key]: s }, r));
      }
    } catch {}
    localStorage.setItem(this.key, JSON.stringify(s));
  },
};
