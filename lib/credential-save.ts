/** Heuristic form classification for password sign-in/signup save offers. */
export function isCredentialSaveForm(
  form: HTMLFormElement,
  submitter: HTMLElement | null,
): boolean {
  const passwordFields = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="password"]'));
  const hasCurrentPassword = passwordFields.some((field) => field.autocomplete.toLowerCase().includes('current-password'));
  const hasNewPassword = passwordFields.some((field) => field.autocomplete.toLowerCase().includes('new-password'));

  // A form with both values is a password change, which this flow does not handle.
  if (hasCurrentPassword && hasNewPassword) return false;

  const label = submitter
    ? [submitter.innerText, submitter.textContent, submitter.getAttribute('aria-label'), 'value' in submitter ? submitter.value : ''].join(' ')
    : '';
  const signInOrSignUp = /log\s*in|sign\s*in|login|signin|sign\s*up|signup|register|create\s+account|continue|next/i.test(label);

  if (hasCurrentPassword) return true;
  if (hasNewPassword) return /sign\s*up|signup|register|create\s+account/i.test(label);
  return signInOrSignUp;
}
