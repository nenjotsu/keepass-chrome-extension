import type { EntriesResponse } from '@/lib/messages';
import { createPageAutofill } from '@/lib/page-autofill';
import type { PendingCredentialData } from '@/lib/types';
import { isCredentialSaveForm } from '@/lib/credential-save';

export default defineContentScript({
  // The bundle is registered for a specific origin only after the user grants
  // optional host access from the popup.
  matches: [],
  main() {
    let fillControlAdded = false;
    let credentialsRequestPending = false;
    const pageAutofill = createPageAutofill(document);
    // Detect login forms on the page
    const observer = new MutationObserver(() => {
      detectForms();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    installCredentialSavePrompt();

    // Initial scan
    setTimeout(detectForms, 500);
    window.addEventListener('focus', detectForms);

    function detectForms() {
      if (fillControlAdded || credentialsRequestPending) return;
      const passwordFields = document.querySelectorAll<HTMLInputElement>(
        'input[type="password"]',
      );
      const hasVisiblePasswordField = Array.from(passwordFields).some(
        (field) => !field.disabled && !field.readOnly && field.getClientRects().length > 0,
      );
      if (!hasVisiblePasswordField) return;
      void requestCredentials();
    }

    async function requestCredentials() {
      credentialsRequestPending = true;
      try {
        const response = (await browser.runtime.sendMessage({
          type: 'GET_ENTRIES_FOR_URL',
          payload: { url: window.location.href },
        })) as EntriesResponse;

        if ('data' in response && response.data.length > 0) {
          const control = pageAutofill.offer(response.data, () => {
            void browser.runtime.sendMessage({ type: 'SESSION_ACTIVITY' }).catch(() => {});
          });
          fillControlAdded = control !== null;
        }
      } catch {
        // Extension might not be unlocked — silently ignore
      } finally {
        credentialsRequestPending = false;
      }
    }

    function findUsernameField(root: ParentNode): HTMLInputElement | null {
      const candidates = root.querySelectorAll<HTMLInputElement>(
        'input[autocomplete="username"], input[name*="user" i], input[name*="login" i], input[name*="email" i], input[type="email"], input[type="text"]',
      );
      return Array.from(candidates).find((input) =>
        !input.disabled && !input.readOnly && input.type !== 'hidden' && input.type !== 'password' && input.getClientRects().length > 0,
      ) ?? null;
    }

    function installCredentialSavePrompt() {
      let submitted: PendingCredentialData | null = null;
      let submittedForm: HTMLFormElement | null = null;
      let fallbackTimer: number | undefined;
      let urlPoll: number | undefined;
      let promptShown = false;
      let previousUrl = location.href;

      document.addEventListener('submit', (event) => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement)) return;
        if (submitted && promptShown) return;
        const submitter = (event as SubmitEvent).submitter;
        if (!isCredentialSaveForm(form, submitter instanceof HTMLElement ? submitter : null)) return;
        const passwordFields = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="password"]'));
        const passwordField = passwordFields
          .find((field) => field.value.length > 0 && !field.disabled && !field.readOnly && field.getClientRects().length > 0);
        if (!passwordField) return;
        const usernameField = findUsernameField(form);
        submitted = {
          password: passwordField.value,
          username: usernameField?.value.trim() ?? '',
          url: location.href,
          title: document.title.trim() || location.hostname,
        };
        submittedForm = form;
        promptShown = false;
        window.clearTimeout(fallbackTimer);
        window.clearInterval(urlPoll);
        fallbackTimer = window.setTimeout(() => void offerSave(false), 5000);
        urlPoll = window.setInterval(() => {
          if (!submitted || location.href === previousUrl) return;
          previousUrl = location.href;
          void offerSave(true);
        }, 300);
        previousUrl = location.href;
      }, true);

      // A form disappearing is a useful success hint for SPA sign-in flows.
      const successObserver = new MutationObserver(() => {
        if (submitted && submittedForm && !submittedForm.isConnected) void offerSave(true);
      });
      successObserver.observe(document.documentElement, { childList: true, subtree: true });

      window.addEventListener('pagehide', () => {
        const credentials = submitted;
        if (!credentials || promptShown) return;
        submitted = null;
        submittedForm = null;
        void browser.runtime.sendMessage({ type: 'STORE_PENDING_CREDENTIALS', payload: credentials }).catch(() => {});
      }, { once: true });

      async function offerSave(successLikely: boolean, pendingCredentials?: PendingCredentialData) {
        if (pendingCredentials) {
          submitted = pendingCredentials;
          submittedForm = null;
        }
        const credentials = submitted;
        if (!credentials || promptShown) return;
        promptShown = true;
        window.clearTimeout(fallbackTimer);
        window.clearInterval(urlPoll);
        const response = await browser.runtime.sendMessage({
          type: 'GET_SAVE_CREDENTIAL_MATCH',
          payload: { url: credentials.url, username: credentials.username },
        }).catch(() => null) as { success?: boolean; data?: { id: string; title: string; username: string; url: string } | null } | null;
        // A locked or absent vault means credentials are discarded immediately.
        if (!response?.success) { submitted = null; return; }

        const match = response.data;
        const groupsResponse = match ? null : await browser.runtime.sendMessage({ type: 'GET_GROUPS' }).catch(() => null) as { success?: boolean; data?: Array<{ id: string; name: string; parentId: string | null }> } | null;
        const groups = groupsResponse?.success ? groupsResponse.data ?? [] : [];
        const host = document.createElement('div');
        host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;right:20px;bottom:20px;';
        const shadow = host.attachShadow({ mode: 'closed' });
        const panel = document.createElement('section');
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', match ? 'Update saved password' : 'Save password');
        panel.style.cssText = 'box-sizing:border-box;width:340px;padding:16px;border:1px solid rgba(80,95,110,.22);border-radius:14px;background:rgba(255,255,255,.97);color:#1f2937;box-shadow:0 12px 36px rgba(15,23,42,.2);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
        const heading = document.createElement('strong');
        heading.textContent = match ? 'Update saved password?' : 'Save this password?';
        heading.style.cssText = 'display:block;font-size:15px;margin-bottom:4px;';
        panel.append(heading);
        if (!successLikely) {
          const note = document.createElement('p');
          note.textContent = 'The website response was not confirmed.';
          note.style.cssText = 'margin:0 0 10px;color:#6b7280;font-size:12px;';
          panel.append(note);
        }
        const fields: Record<string, HTMLInputElement> = {};
        const values = { title: match?.title || credentials.title, url: match?.url || credentials.url, username: match?.username || credentials.username };
        for (const [key, labelText] of [['title', 'Title'], ['url', 'Website'], ['username', 'Username']]) {
          const label = document.createElement('label');
          label.textContent = labelText;
          label.style.cssText = 'display:block;margin:8px 0 3px;color:#4b5563;font-size:12px;';
          const input = document.createElement('input');
          input.value = values[key as keyof typeof values];
          input.type = 'text';
          input.autocomplete = 'off';
          input.style.cssText = 'box-sizing:border-box;width:100%;padding:8px 9px;border:1px solid rgba(75,85,99,.22);border-radius:7px;background:rgba(249,250,251,.86);color:#111827;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;outline-color:#6da889;';
          fields[key] = input;
          label.append(input);
          panel.append(label);
        }
        const selectedGroup = document.createElement('select');
        selectedGroup.style.cssText = 'box-sizing:border-box;width:100%;padding:8px 9px;border:1px solid rgba(75,85,99,.22);border-radius:7px;background:rgba(249,250,251,.86);color:#111827;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
        const rootOption = document.createElement('option');
        rootOption.value = '';
        rootOption.textContent = 'Root group';
        selectedGroup.append(rootOption);
        for (const group of groups.filter((group) => group.parentId !== null)) {
          const option = document.createElement('option');
          option.value = group.id;
          option.textContent = group.name;
          selectedGroup.append(option);
        }
        if (!match) {
          const groupLabel = document.createElement('label');
          groupLabel.textContent = 'Group';
          groupLabel.style.cssText = 'display:block;margin:8px 0 3px;color:#4b5563;font-size:12px;';
          groupLabel.append(selectedGroup);
          panel.append(groupLabel);
        }
        const passwordLabel = document.createElement('label');
        passwordLabel.textContent = 'Password';
        passwordLabel.style.cssText = 'display:block;margin:8px 0 3px;color:#4b5563;font-size:12px;';
        const passwordInput = document.createElement('input');
        passwordInput.type = 'password';
        passwordInput.autocomplete = 'new-password';
        passwordInput.value = credentials.password;
        passwordInput.style.cssText = 'box-sizing:border-box;width:100%;padding:8px 9px;border:1px solid rgba(75,85,99,.22);border-radius:7px;background:rgba(249,250,251,.86);color:#111827;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
        passwordLabel.append(passwordInput);
        panel.append(passwordLabel);
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:14px;';
        const button = (text: string, primary: boolean) => {
          const element = document.createElement('button');
          element.type = 'button';
          element.textContent = text;
          element.style.cssText = `padding:7px 12px;border:1px solid rgba(75,85,99,.18);border-radius:7px;background:${primary ? '#218356' : 'rgba(249,250,251,.9)'};color:${primary ? '#fff' : '#374151'};font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;`;
          return element;
        };
        const never = button('Never', false);
        const save = button(match ? 'Update' : 'Save', true);
        never.addEventListener('click', () => { passwordInput.value = ''; host.remove(); submitted = null; promptShown = false; });
        save.addEventListener('click', async () => {
          save.disabled = true;
          if (match) {
            await browser.runtime.sendMessage({ type: 'UPDATE_ENTRY_PASSWORD', payload: { id: match.id, title: fields.title.value.trim(), url: fields.url.value.trim(), username: fields.username.value.trim(), password: passwordInput.value } }).catch(() => null);
          } else {
            await browser.runtime.sendMessage({ type: 'CREATE_ENTRY', payload: { entry: { title: fields.title.value.trim(), url: fields.url.value.trim(), username: fields.username.value.trim(), password: passwordInput.value, notes: '', tags: [], groupId: selectedGroup.value, autoFill: true } } }).catch(() => null);
          }
          passwordInput.value = '';
          host.remove();
          submitted = null;
          promptShown = false;
        });
        actions.append(never, save);
        panel.append(actions);
        shadow.append(panel);
        document.documentElement.append(host);
        fields.title.focus();
      }

      void browser.runtime.sendMessage({ type: 'TAKE_PENDING_CREDENTIALS' })
        .then((response: { success?: boolean; data?: PendingCredentialData | null }) => {
          if (response?.success && response.data) void offerSave(true, response.data);
        })
        .catch(() => {});
    }
  },
});
