export interface PageCredentials {
  title: string;
  username: string;
  password: string;
}

export interface FilledLoginForm {
  usernameField: HTMLInputElement | null;
  passwordField: HTMLInputElement;
}

/** Offer a user-clicked Fill action for the first visible login form on the page. */
export function createPageAutofill(
  root: ParentNode,
  isTrustedClick: (event: MouseEvent) => boolean = (event) => event.isTrusted,
) {
  let completed = false;
  let offered = false;

  function tryFill(credentials: PageCredentials): FilledLoginForm | null {
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

    return { usernameField, passwordField };
  }

  return {
    /** Add a control without exposing credentials in page fields before a click. */
    offer(entries: PageCredentials[], onFilled?: () => void): HTMLButtonElement | null {
      if (offered || entries.length === 0) return null;
      const passwordField = Array.from(
        root.querySelectorAll<HTMLInputElement>('input[type="password"]'),
      ).find(isVisibleAndEditable);
      const parent = passwordField?.parentElement;
      if (!passwordField || !parent) return null;

      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Fill';
      button.title = `Fill ${entries[0].title || 'saved credentials'}`;
      button.setAttribute('aria-label', button.title);
      button.style.cssText = 'position:absolute;right:8px;top:50%;transform:translateY(-50%);z-index:10000;padding:4px 8px;border:0;border-radius:6px;background:#15803d;color:white;font:12px sans-serif;cursor:pointer;';

      if (window.getComputedStyle(parent).position === 'static') {
        parent.style.position = 'relative';
      }
      parent.appendChild(button);
      offered = true;

      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!isTrustedClick(event)) return;
        if (!tryFill(entries[0])) return;
        onFilled?.();
      });

      return button;
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

function setNativeValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
