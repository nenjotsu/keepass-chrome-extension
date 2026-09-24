import { describe, expect, it } from 'vitest';
import { isCredentialSaveForm } from '@/lib/credential-save';

function makeForm(autocomplete: string[] = []): HTMLFormElement {
  const form = document.createElement('form');
  for (const value of autocomplete) {
    const input = document.createElement('input');
    input.type = 'password';
    input.setAttribute('autocomplete', value);
    form.append(input);
  }
  return form;
}

function makeSubmitter(label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = label;
  return button;
}

describe('credential save form detection', () => {
  it('recognizes current-password sign-in forms', () => {
    expect(isCredentialSaveForm(makeForm(['username', 'current-password']), null)).toBe(true);
  });

  it('recognizes a new-password form when its submit button signals signup', () => {
    expect(isCredentialSaveForm(makeForm(['new-password']), makeSubmitter('Create account'))).toBe(true);
  });

  it('recognizes common sign-in labels when autocomplete is missing', () => {
    expect(isCredentialSaveForm(makeForm(['']), makeSubmitter('Sign in'))).toBe(true);
  });

  it('ignores password-change forms', () => {
    expect(isCredentialSaveForm(makeForm(['current-password', 'new-password']), makeSubmitter('Update password'))).toBe(false);
  });

  it('ignores unclassified password forms and new-password reset forms', () => {
    expect(isCredentialSaveForm(makeForm(['']), makeSubmitter('Submit'))).toBe(false);
    expect(isCredentialSaveForm(makeForm(['new-password']), makeSubmitter('Reset password'))).toBe(false);
  });
});
