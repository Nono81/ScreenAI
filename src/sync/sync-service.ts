// ============================================
// ScreenAI — Sync Service (IndexedDB ↔ Supabase)
// ============================================
// Offline-first: IndexedDB is the local cache, Supabase is the source of truth.
// On launch (if signed in): pull changes from Supabase → merge into IndexedDB.
// On local modification: push to Supabase in background.
// Conflict resolution: last-write-wins using updatedAt timestamp.

import { getSupabase } from '../auth/supabase';
import { authService } from '../auth/auth-service';
import { projectStore, conversationStore, settingsStore } from '../storage';
import type { Project, Conversation, Message, AppSettings } from '../types';

export class SyncService {
  private isSyncing = false;
  private syncQueue: SyncOperation[] = [];
  private userId: string | null = null;

  constructor() {
    // Listen for auth changes
    authService.onAuthChange((state, user) => {
      if (state === 'signed_in' && user) {
        this.userId = user.id;
        this.pullFromCloud();
      } else {
        this.userId = null;
      }
    });
  }

  // --- Pull from Cloud ---

  async pullFromCloud(): Promise<void> {
    if (!this.userId || this.isSyncing) return;
    const supabase = getSupabase();
    if (!supabase) return;

    this.isSyncing = true;

    try {
      // Pull projects
      const { data: cloudProjects } = await supabase
        .from('projects')
        .select('*')
        .eq('user_id', this.userId);

      if (cloudProjects) {
        const localProjects = await projectStore.getAll();
        for (const cp of cloudProjects) {
          const local = localProjects.find(p => p.id === cp.id);
          if (!local || new Date(cp.updated_at).getTime() > local.updatedAt) {
            // Cloud is newer, update local
            const mapped = {
              name: cp.name as string,
              description: (cp.description || '') as string,
              instructions: (cp.instructions || '') as string,
              provider: cp.default_provider as any,
              model: cp.default_model as string,
            };
            if (local) {
              await projectStore.update(cp.id, mapped);
            } else {
              await projectStore.create(mapped);
            }
          }
        }
      }

      // Pull conversations
      const { data: cloudConvs } = await supabase
        .from('conversations')
        .select('*')
        .eq('user_id', this.userId);

      if (cloudConvs) {
        const localConvs = await conversationStore.getAll();
        for (const cc of cloudConvs) {
          const local = localConvs.find(c => c.id === cc.id);
          if (!local || new Date(cc.updated_at).getTime() > local.updatedAt) {
            // Pull messages for this conversation
            const { data: messages } = await supabase
              .from('messages')
              .select('*')
              .eq('conversation_id', cc.id)
              .order('created_at', { ascending: true });

            const mappedMessages: Message[] = (messages || []).map((m: any) => ({
              id: m.id,
              role: m.role,
              content: m.content || '',
              timestamp: new Date(m.created_at).getTime(),
              provider: m.provider,
              model: m.model,
              screenshot: m.screenshot_url ? {
                dataUrl: m.screenshot_url,
                annotations: m.annotations || [],
                timestamp: new Date(m.created_at).getTime(),
              } : undefined,
            }));

            if (local) {
              await conversationStore.update(cc.id, {
                title: cc.title,
                provider: cc.provider,
                model: cc.model,
                projectId: cc.project_id || undefined,
                updatedAt: new Date(cc.updated_at).getTime(),
                messages: mappedMessages,
              });
            } else {
              // Create locally with cloud data
              const conv = await conversationStore.create(
                cc.provider, cc.model, cc.project_id || undefined
              );
              await conversationStore.update(conv.id, {
                id: cc.id,
                title: cc.title,
                messages: mappedMessages,
                updatedAt: new Date(cc.updated_at).getTime(),
              });
            }
          }
        }
      }

      // Pull settings
      const { data: cloudSettings } = await supabase
        .from('user_settings')
        .select('settings')
        .eq('user_id', this.userId)
        .single();

      if (cloudSettings?.settings) {
        const localSettings = await settingsStore.get();
        const cloudUpdated = cloudSettings.settings.updatedAt || 0;
        // Only overwrite if cloud is newer
        if (cloudUpdated > (localSettings as any).updatedAt || 0) {
          await settingsStore.save({ ...localSettings, ...cloudSettings.settings });
        }
      }

      // Process queued operations
      await this.processQueue();
    } catch (err) {
      console.error('Sync pull failed:', err);
    }

    this.isSyncing = false;
  }

  // --- Push to Cloud ---

  async pushProject(project: Project): Promise<void> {
    this.enqueue({ type: 'project', action: 'upsert', data: project });
    await this.processQueue();
  }

  async deleteProjectCloud(id: string): Promise<void> {
    this.enqueue({ type: 'project', action: 'delete', id });
    await this.processQueue();
  }

  async pushConversation(conversation: Conversation): Promise<void> {
    this.enqueue({ type: 'conversation', action: 'upsert', data: conversation });
    await this.processQueue();
  }

  async deleteConversationCloud(id: string): Promise<void> {
    this.enqueue({ type: 'conversation', action: 'delete', id });
    await this.processQueue();
  }

  async pushSettings(settings: AppSettings): Promise<void> {
    this.enqueue({ type: 'settings', action: 'upsert', data: settings });
    await this.processQueue();
  }

  // --- Queue Processing ---

  private enqueue(op: SyncOperation) {
    this.syncQueue.push(op);
    // Persist queue to localStorage for offline resilience
    try {
      localStorage.setItem('screenai_sync_queue', JSON.stringify(this.syncQueue));
    } catch {}
  }

  private async processQueue(): Promise<void> {
    if (!this.userId) return;
    const supabase = getSupabase();
    if (!supabase) return;

    const queue = [...this.syncQueue];
    this.syncQueue = [];

    for (const op of queue) {
      try {
        await this.executeSyncOp(supabase, op);
      } catch (err) {
        console.error('Sync op failed, re-queuing:', op, err);
        this.syncQueue.push(op);
      }
    }

    // Update persisted queue
    try {
      localStorage.setItem('screenai_sync_queue', JSON.stringify(this.syncQueue));
    } catch {}
  }

  private async executeSyncOp(supabase: any, op: SyncOperation): Promise<void> {
    switch (op.type) {
      case 'project':
        if (op.action === 'upsert' && op.data) {
          const p = op.data as Project;
          await supabase.from('projects').upsert({
            id: p.id,
            user_id: this.userId,
            name: p.name,
            description: p.description,
            instructions: p.instructions,
            default_provider: p.provider,
            default_model: p.model,
            updated_at: new Date(p.updatedAt).toISOString(),
          });
        } else if (op.action === 'delete' && op.id) {
          await supabase.from('projects').delete().eq('id', op.id);
        }
        break;

      case 'conversation':
        if (op.action === 'upsert' && op.data) {
          const c = op.data as Conversation;
          await supabase.from('conversations').upsert({
            id: c.id,
            user_id: this.userId,
            project_id: c.projectId || null,
            title: c.title,
            provider: c.provider,
            model: c.model,
            updated_at: new Date(c.updatedAt).toISOString(),
          });

          // Upsert messages
          if (c.messages.length > 0) {
            const msgs = c.messages.map(m => ({
              id: m.id,
              conversation_id: c.id,
              role: m.role,
              content: m.content,
              provider: m.provider,
              model: m.model,
              screenshot_url: m.screenshot?.dataUrl || null,
              annotations: m.screenshot?.annotations || [],
              created_at: new Date(m.timestamp).toISOString(),
            }));
            await supabase.from('messages').upsert(msgs);
          }
        } else if (op.action === 'delete' && op.id) {
          await supabase.from('conversations').delete().eq('id', op.id);
        }
        break;

      case 'settings':
        if (op.action === 'upsert' && op.data) {
          await supabase.from('user_settings').upsert({
            user_id: this.userId,
            settings: { ...op.data, updatedAt: Date.now() },
          });
        }
        break;
    }
  }
}

interface SyncOperation {
  type: 'project' | 'conversation' | 'settings';
  action: 'upsert' | 'delete';
  data?: any;
  id?: string;
}

// Singleton
export const syncService = new SyncService();
