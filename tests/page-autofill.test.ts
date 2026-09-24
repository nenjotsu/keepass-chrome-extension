import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPageAutofill } from '@/lib/page-autofill';

describe('user-initiated page autofill', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps credentials out of the page until the user clicks Fill', () => {
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

    const autofill = createPageAutofill(document, () => true);
    const fillButton = autofill.offer([{ title: 'Example', username: 'alice', password: 'secret' }]);

    expect(user.value).toBe('');
    expect(password.value).toBe('');
    expect(fillButton).not.toBeNull();
    fillButton!.click();
    expect(user.value).toBe('alice');
    expect(password.value).toBe('secret');
    expect(inputEvents).toHaveBeenCalledTimes(2);
    expect(changeEvents).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll('form')[1].querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe('');
  });

  it('does not submit the form after the user clicks Fill', () => {
    document.body.innerHTML = `
      <form>
        <input type="text" autocomplete="username">
        <input type="password">
        <button type="submit">Sign in</button>
      </form>`;
    const form = document.querySelector('form')!;
    form.querySelectorAll('input, button').forEach(makeVisible);
    const submit = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener('submit', submit);
    const fillButton = createPageAutofill(document, () => true).offer([
      { title: 'Example', username: 'alice', password: 'secret' },
    ]);

    fillButton!.click();

    expect(submit).not.toHaveBeenCalled();
    expect(form.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe('alice');
  });

  it('ignores synthetic clicks that a website script could trigger', () => {
    document.body.innerHTML = `
      <form>
        <input type="text" name="username">
        <input type="password">
      </form>`;
    const [user, password] = Array.from(document.querySelectorAll('input'));
    makeVisible(user);
    makeVisible(password);
    const fillButton = createPageAutofill(document).offer([
      { title: 'Example', username: 'alice', password: 'secret' },
    ]);

    fillButton!.click();

    expect(user.value).toBe('');
    expect(password.value).toBe('');
  });
});

function makeVisible(element: Element): void {
  vi.spyOn(element, 'getClientRects').mockReturnValue([{} as DOMRect] as unknown as DOMRectList);
}
