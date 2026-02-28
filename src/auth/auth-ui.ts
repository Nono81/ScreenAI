// ============================================
// ScreenAI — Auth UI (Login / Register / Forgot Password)
// ============================================

import { authService, type AuthState, type UserProfile } from './auth-service';
import { isSupabaseConfigured } from './supabase';
import { ICONS } from '../ui/main/icons';
import { t } from '../ui/main/i18n';

export type AuthScreen = 'login' | 'register' | 'forgot' | 'check-email';

export interface AuthUIEvents {
  onAuthenticated: (user: UserProfile) => void;
  onSkip: () => void;
}

export class AuthUI {
  private el: HTMLElement;
  private currentScreen: AuthScreen = 'login';
  private isLoading = false;

  constructor(private container: HTMLElement, private events: AuthUIEvents) {
    this.el = document.createElement('div');
    this.el.className = 'auth-screen';
    this.container.appendChild(this.el);

    // If Supabase not configured, skip to local mode
    if (!isSupabaseConfigured()) {
      this.events.onSkip();
      return;
    }

    // Listen for auth changes
    authService.onAuthChange((state, user) => {
      if (state === 'signed_in' && user) {
        this.events.onAuthenticated(user);
      }
    });

    this.render();
  }

  show() {
    this.el.style.display = '';
    this.render();
  }

  hide() {
    this.el.style.display = 'none';
  }

  destroy() {
    this.el.remove();
  }

  private render() {
    switch (this.currentScreen) {
      case 'login': return this.renderLogin();
      case 'register': return this.renderRegister();
      case 'forgot': return this.renderForgot();
      case 'check-email': return this.renderCheckEmail();
    }
  }

  private renderLogin() {
    this.el.innerHTML = `
      <div class="auth-card">
        <div style="text-align:center;margin-bottom:16px">
          <div class="logo" style="margin:0 auto 12px;width:40px;height:40px;border-radius:12px">${ICONS.logo}</div>
        </div>
        <h2>Sign in to ScreenAI</h2>
        <p class="auth-sub">Access your projects and conversations from anywhere</p>

        <div class="auth-error" data-error></div>

        <form data-form>
          <div class="mf">
            <label>EMAIL</label>
            <input class="minp" type="email" name="email" placeholder="you@example.com" required>
          </div>
          <div class="mf">
            <label>PASSWORD</label>
            <input class="minp" type="password" name="password" placeholder="Your password" required minlength="6">
          </div>
          <div style="text-align:right;margin-bottom:12px">
            <span class="auth-link" data-action="forgot">Forgot password?</span>
          </div>
          <button type="submit" class="bsv" style="margin-top:0">Sign in</button>
        </form>

        <div class="auth-sep">or</div>

        <button class="auth-google" data-action="google">
          ${ICONS.google}
          Continue with Google
        </button>

        <div class="auth-footer">
          Don't have an account? <span class="auth-link" data-action="register">Sign up</span>
        </div>

        <span class="auth-skip" data-action="skip">Continue without an account</span>
      </div>
    `;

    this.bindForm();
  }

  private renderRegister() {
    this.el.innerHTML = `
      <div class="auth-card">
        <div style="text-align:center;margin-bottom:16px">
          <div class="logo" style="margin:0 auto 12px;width:40px;height:40px;border-radius:12px">${ICONS.logo}</div>
        </div>
        <h2>Create your account</h2>
        <p class="auth-sub">Start capturing and asking AI for free</p>

        <div class="auth-error" data-error></div>

        <form data-form>
          <div class="mf">
            <label>EMAIL</label>
            <input class="minp" type="email" name="email" placeholder="you@example.com" required>
          </div>
          <div class="mf">
            <label>PASSWORD</label>
            <input class="minp" type="password" name="password" placeholder="Minimum 6 characters" required minlength="6">
          </div>
          <div class="mf">
            <label>CONFIRM PASSWORD</label>
            <input class="minp" type="password" name="confirmPassword" placeholder="Confirm your password" required minlength="6">
          </div>
          <button type="submit" class="bsv" style="margin-top:4px">Create account</button>
        </form>

        <div class="auth-sep">or</div>

        <button class="auth-google" data-action="google">
          ${ICONS.google}
          Continue with Google
        </button>

        <div class="auth-footer">
          Already have an account? <span class="auth-link" data-action="login">Sign in</span>
        </div>

        <span class="auth-skip" data-action="skip">Continue without an account</span>
      </div>
    `;

    this.bindForm();
  }

  private renderForgot() {
    this.el.innerHTML = `
      <div class="auth-card">
        <div style="text-align:center;margin-bottom:16px">
          <div class="logo" style="margin:0 auto 12px;width:40px;height:40px;border-radius:12px">${ICONS.logo}</div>
        </div>
        <h2>Reset your password</h2>
        <p class="auth-sub">We'll send you a link to reset your password</p>

        <div class="auth-error" data-error></div>

        <form data-form>
          <div class="mf">
            <label>EMAIL</label>
            <input class="minp" type="email" name="email" placeholder="you@example.com" required>
          </div>
          <button type="submit" class="bsv" style="margin-top:4px">Send reset link</button>
        </form>

        <div class="auth-footer" style="margin-top:16px">
          <span class="auth-link" data-action="login">Back to sign in</span>
        </div>
      </div>
    `;

    this.bindForm();
  }

  private renderCheckEmail() {
    this.el.innerHTML = `
      <div class="auth-card" style="text-align:center">
        <div style="margin-bottom:16px">
          <div class="logo" style="margin:0 auto 12px;width:40px;height:40px;border-radius:12px">${ICONS.logo}</div>
        </div>
        <h2>Check your email</h2>
        <div class="auth-success">
          We sent you a verification link. Please check your inbox and click the link to continue.
        </div>
        <div class="auth-footer" style="margin-top:16px">
          <span class="auth-link" data-action="login">Back to sign in</span>
        </div>
      </div>
    `;

    this.bindNavigation();
  }

  private bindForm() {
    this.bindNavigation();

    const form = this.el.querySelector<HTMLFormElement>('[data-form]')!;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (this.isLoading) return;

      this.isLoading = true;
      const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      const originalText = submitBtn.textContent;
      submitBtn.textContent = '...';
      submitBtn.disabled = true;

      const fd = new FormData(form);
      let result: { error?: string } = {};

      switch (this.currentScreen) {
        case 'login':
          result = await authService.signIn(
            fd.get('email') as string,
            fd.get('password') as string
          );
          break;

        case 'register': {
          const password = fd.get('password') as string;
          const confirm = fd.get('confirmPassword') as string;
          if (password !== confirm) {
            result = { error: 'Passwords do not match' };
            break;
          }
          result = await authService.signUp(
            fd.get('email') as string,
            password
          );
          if (!result.error) {
            this.currentScreen = 'check-email';
            this.render();
            this.isLoading = false;
            return;
          }
          break;
        }

        case 'forgot':
          result = await authService.resetPassword(fd.get('email') as string);
          if (!result.error) {
            this.currentScreen = 'check-email';
            this.render();
            this.isLoading = false;
            return;
          }
          break;
      }

      this.isLoading = false;
      submitBtn.textContent = originalText;
      submitBtn.disabled = false;

      if (result.error) {
        this.showError(result.error);
      }
    });
  }

  private bindNavigation() {
    // Screen navigation
    this.el.querySelector('[data-action="login"]')?.addEventListener('click', () => {
      this.currentScreen = 'login';
      this.render();
    });
    this.el.querySelector('[data-action="register"]')?.addEventListener('click', () => {
      this.currentScreen = 'register';
      this.render();
    });
    this.el.querySelector('[data-action="forgot"]')?.addEventListener('click', () => {
      this.currentScreen = 'forgot';
      this.render();
    });

    // Google OAuth
    this.el.querySelector('[data-action="google"]')?.addEventListener('click', async () => {
      const result = await authService.signInWithGoogle();
      if (result.error) this.showError(result.error);
    });

    // Skip (local mode)
    this.el.querySelector('[data-action="skip"]')?.addEventListener('click', () => {
      this.events.onSkip();
    });
  }

  private showError(message: string) {
    const errorEl = this.el.querySelector('[data-error]');
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.classList.add('show');
      setTimeout(() => errorEl.classList.remove('show'), 5000);
    }
  }
}
