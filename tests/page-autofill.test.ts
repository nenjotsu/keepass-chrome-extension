import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPageAutofill } from '@/lib/page-autofill';

describe('automatic page autofill', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('fills the first visible login form and dispatches input events', () => {
    document.body.innerHTML = `
      <form>
        <input type="text" name="username">
        <input type="password">
      </form>
      <form>
        <input type="text" name="username">
        <input type="password">
      </form>`;
    const [user, password] = Array.from(document.querySelectorAll('input'));
    makeVisible(user);
    makeVisible(password);
    const inputEvents = vi.fn();
    const changeEvents = vi.fn();
    user.addEventListener('input', inputEvents);
    password.addEventListener('input', inputEvents);
    user.addEventListener('change', changeEvents);
    password.addEventListener('change', changeEvents);

    const autofill = createPageAutofill(document);
    const result = autofill.tryFill({ username: 'alice', password: 'secret', autoLogin: false });

    expect(result).not.toBeNull();
    expect(user.value).toBe('alice');
    expect(password.value).toBe('secret');
    expect(inputEvents).toHaveBeenCalledTimes(2);
    expect(changeEvents).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll('form')[1].querySelector('input[type="password"]')?.value).toBe('');
  });

  it('submits once after filling when Auto Login is enabled and a clear submit button exists', () => {
    document.body.innerHTML = `
      <form>
        <input type="text" autocomplete="username">
        <input type="password">
        <button type="submit">Sign in</button>
      </form>`;
    const form = document.querySelector('form')!;
    form.querySelectorAll('input, button').forEach(makeVisible);
    const submit = vi.spyOn(form.querySelector('button')!, 'click').mockImplementation(() => {});
    const autofill = createPageAutofill(document);

    expect(autofill.tryFill({ username: 'alice', password: 'secret', autoLogin: true })).not.toBeNull();
    expect(autofill.tryFill({ username: 'bob', password: 'other', autoLogin: true })).toBeNull();

    expect(submit).toHaveBeenCalledTimes(1);
    expect(form.querySelector('input[type="text"]')?.value).toBe('alice');
  });

  it('does not submit when Auto Login is enabled but no clear submit button exists', () => {
    document.body.innerHTML = `
      <form>
        <input type="text" name="username">
        <input type="password">
        <button type="button">Help</button>
      </form>`;
    const form = document.querySelector('form')!;
    form.querySelectorAll('input, button').forEach(makeVisible);
    const help = vi.spyOn(form.querySelector('button')!, 'click');

    createPageAutofill(document).tryFill({ username: 'alice', password: 'secret', autoLogin: true });

    expect(help).not.toHaveBeenCalled();
    expect(form.querySelector('input[type="password"]')?.value).toBe('secret');
  });
});

function makeVisible(element: Element): void {
  vi.spyOn(element, 'getClientRects').mockReturnValue([{} as DOMRect]);
}
