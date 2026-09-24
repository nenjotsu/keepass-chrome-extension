export interface PageCredentials {
  username: string;
  password: string;
  autoLogin?: boolean;
}

export interface FilledLoginForm {
  usernameField: HTMLInputElement | null;
  passwordField: HTMLInputElement;
}

/** Create a one-page autofill action that fills the first visible login form at most once. */
export function createPageAutofill(root: ParentNode) {
  let completed = false;

  return {
    tryFill(credentials: PageCredentials): FilledLoginForm | null {
      if (completed) return null;

      const passwordField = Array.from(
        root.querySelectorAll<HTMLInputElement>('input[type="password"]'),
      ).find(isVisibleAndEditable);
      if (!passwordField) return null;

      const form = passwordField.closest('form');
      const usernameRoot: ParentNode = form ?? root;
      const usernameField = findUsernameField(usernameRoot);

      if (usernameField) setNativeValue(usernameField, credentials.username);
      setNativeValue(passwordField, credentials.password);
      completed = true;

      if (credentials.autoLogin && form) {
        findClearSubmitButton(form)?.click();
      }

      return { usernameField, passwordField };
    },
  };
}

function isVisibleAndEditable(input: HTMLInputElement): boolean {
  return !input.disabled && !input.readOnly && input.type !== 'hidden' && input.getClientRects().length > 0;
}

function findUsernameField(root: ParentNode): HTMLInputElement | null {
  const candidates = root.querySelectorAll<HTMLInputElement>(
    'input[autocomplete="username"], input[name*="user" i], input[name*="login" i], input[name*="email" i], input[type="email"], input[type="text"]',
  );
  return Array.from(candidates).find((input) => {
    const type = input.type.toLowerCase();
    return !input.disabled && !input.readOnly && type !== 'hidden' && type !== 'password' && input.getClientRects().length > 0;
  }) ?? null;
}

function findClearSubmitButton(form: HTMLFormElement): HTMLElement | null {
  const explicitSubmit = Array.from(form.querySelectorAll<HTMLElement>(
    'button[type="submit"], input[type="submit"]',
  )).find((button) => !('disabled' in button && button.disabled) && button.getClientRects().length > 0);
  if (explicitSubmit) return explicitSubmit;

  return Array.from(form.querySelectorAll<HTMLButtonElement>('button'))
    .find((button) => /^(log\s*in|sign\s*in|login|continue)$/i.test((button.innerText || button.getAttribute('aria-label') || '').trim())
      && !button.disabled && button.getClientRects().length > 0) ?? null;
}

function setNativeValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
