// ============================================
// ScreenAI — Authentication Service
// ============================================

import type { User, Session, AuthChangeEvent } from '@supabase/supabase-js';
import { getSupabase, isSupabaseConfigured } from './supabase';

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  plan: 'free' | 'pro';
}

export type AuthState = 'loading' | 'signed_in' | 'signed_out' | 'unconfigured';

class AuthService {
  private listeners: ((state: AuthState, user: UserProfile | null) => void)[] = [];
  private currentUser: UserProfile | null = null;
  private currentState: AuthState = 'loading';

  constructor() {
    this.initListener();
  }

  private initListener() {
    if (!isSupabaseConfigured()) {
      this.currentState = 'unconfigured';
      return;
    }

    const supabase = getSupabase();
    if (!supabase) return;

    supabase.auth.onAuthStateChange(async (event: AuthChangeEvent, session: Session | null) => {
      if (session?.user) {
        this.currentUser = this.mapUser(session.user);
        this.currentState = 'signed_in';
      } else {
        this.currentUser = null;
        this.currentState = 'signed_out';
      }
      this.notifyListeners();
    });

    // Check initial session
    this.checkSession();
  }

  private async checkSession() {
    const supabase = getSupabase();
    if (!supabase) {
      this.currentState = 'unconfigured';
      this.notifyListeners();
      return;
    }

    const { data } = await supabase.auth.getSession();
    if (data.session?.user) {
      this.currentUser = this.mapUser(data.session.user);
      this.currentState = 'signed_in';
    } else {
      this.currentState = 'signed_out';
    }
    this.notifyListeners();
  }

  private mapUser(user: User): UserProfile {
    return {
      id: user.id,
      email: user.email || '',
      displayName: user.user_metadata?.display_name || user.email?.split('@')[0] || 'User',
      avatarUrl: user.user_metadata?.avatar_url || null,
      plan: 'free',
    };
  }

  // --- Public API ---

  getState(): AuthState {
    return this.currentState;
  }

  getUser(): UserProfile | null {
    return this.currentUser;
  }

  onAuthChange(listener: (state: AuthState, user: UserProfile | null) => void): () => void {
    this.listeners.push(listener);
    // Immediately notify with current state
    listener(this.currentState, this.currentUser);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  async signUp(email: string, password: string): Promise<{ error?: string }> {
    const supabase = getSupabase();
    if (!supabase) return { error: 'Supabase not configured' };

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });

    if (error) return { error: error.message };
    return {};
  }

  async signIn(email: string, password: string): Promise<{ error?: string }> {
    const supabase = getSupabase();
    if (!supabase) return { error: 'Supabase not configured' };

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return {};
  }

  async signInWithGoogle(): Promise<{ error?: string }> {
    const supabase = getSupabase();
    if (!supabase) return { error: 'Supabase not configured' };

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    });

    if (error) return { error: error.message };
    return {};
  }

  async signOut(): Promise<void> {
    const supabase = getSupabase();
    if (!supabase) return;

    await supabase.auth.signOut();
    this.currentUser = null;
    this.currentState = 'signed_out';
    this.notifyListeners();
  }

  async resetPassword(email: string): Promise<{ error?: string }> {
    const supabase = getSupabase();
    if (!supabase) return { error: 'Supabase not configured' };

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) return { error: error.message };
    return {};
  }

  async updatePassword(newPassword: string): Promise<{ error?: string }> {
    const supabase = getSupabase();
    if (!supabase) return { error: 'Supabase not configured' };

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { error: error.message };
    return {};
  }

  private notifyListeners() {
    for (const listener of this.listeners) {
      listener(this.currentState, this.currentUser);
    }
  }
}

// Singleton
export const authService = new AuthService();
