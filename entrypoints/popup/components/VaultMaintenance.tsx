import { useEffect, useState } from 'react';
import { sendMessage } from '@/lib/messages';

type Backup = { timestamp: number; version: number; reason: string; size: number };
type BackupResponse = { backups: Backup[]; totalSize: number };

interface Props {
  onClose: () => void;
  onRestored: () => void;
}

export function VaultMaintenance({ onClose, onRestored }: Props) {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [restorePassword, setRestorePassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const loadBackups = async () => {
    const response = await sendMessage({ type: 'GET_BACKUP_HISTORY', payload: { limit: 10 } });
    if (response.success) setBackups((response.data as BackupResponse).backups);
    else setMessage(response.error);
  };

  useEffect(() => { void loadBackups(); }, []);

  const createBackup = async () => {
    setBusy(true);
    setMessage('');
    const response = await sendMessage({ type: 'CREATE_BACKUP' });
    if (response.success) {
      setBackups(response.data as Backup[]);
      setMessage('Encrypted backup created. Download a .kdbx export periodically for protection against device loss.');
    } else setMessage(response.error);
    setBusy(false);
  };

  const restore = async (timestamp: number) => {
    if (!restorePassword) return setMessage('Enter the vault master password to restore this backup.');
    if (!window.confirm('Restore this snapshot? Current vault data will be replaced.')) return;
    setBusy(true);
    setMessage('');
    const response = await sendMessage({ type: 'RESTORE_FROM_BACKUP', payload: { timestamp, password: restorePassword } });
    setBusy(false);
    if (response.success) {
      setRestorePassword('');
      onRestored();
      onClose();
    } else setMessage(response.error);
  };

  const changePassword = async () => {
    setMessage('');
    if (newPassword.length < 8) return setMessage('Choose a master password with at least 8 characters.');
    if (newPassword !== confirmation) return setMessage('New passwords do not match.');
    setBusy(true);
    const response = await sendMessage({ type: 'CHANGE_MASTER_PASSWORD', payload: { currentPassword, newPassword } });
    setBusy(false);
    if (response.success) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      const freshBackupCreated = Boolean((response.data as { freshBackupCreated?: boolean }).freshBackupCreated);
      setBackups([]);
      setMessage(freshBackupCreated
        ? 'Master password changed. The vault was re-encrypted and old snapshots were replaced with a new backup.'
        : 'Master password changed and the vault was re-encrypted, but a new snapshot could not be created. Export the vault now.');
    } else setMessage(response.error);
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
    <section role="dialog" aria-modal="true" aria-labelledby="vault-maintenance-title" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 id="vault-maintenance-title" className="text-lg font-semibold text-gray-900">Vault backup and security</h2>
        <button type="button" onClick={onClose} className="rounded px-2 py-1 text-gray-500 hover:bg-gray-100" aria-label="Close">×</button>
      </div>

      <div className="mb-6">
        <h3 className="font-medium text-gray-900">Encrypted snapshots</h3>
        <p className="mt-1 text-xs text-gray-500">Snapshots stay in this browser profile. Export the .kdbx file to another device or drive for protection against device loss.</p>
        <button type="button" disabled={busy} onClick={() => void createBackup()} className="mt-3 rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Create backup now</button>
        {backups.length > 0 && <input type="password" autoComplete="current-password" value={restorePassword} onChange={(e) => setRestorePassword(e.target.value)} placeholder="Vault password to restore a snapshot" className="mt-3 w-full rounded border border-gray-300 px-3 py-2 text-sm" />}
        <div className="mt-3 space-y-2">
          {backups.length === 0 && <p className="text-sm text-gray-500">No snapshots yet.</p>}
          {backups.map((backup) => <div key={backup.timestamp} className="flex items-center justify-between gap-3 rounded border border-gray-200 p-2">
            <div><div className="text-sm text-gray-800">{new Date(backup.timestamp).toLocaleString()}</div><div className="text-xs text-gray-500">{backup.reason} · {(backup.size / 1024).toFixed(0)} KB</div></div>
            <button type="button" disabled={busy || !restorePassword} onClick={() => void restore(backup.timestamp)} className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 disabled:opacity-50">Restore</button>
          </div>)}
        </div>
      </div>

      <div className="border-t border-gray-200 pt-4">
        <h3 className="font-medium text-gray-900">Change master password</h3>
        <p className="mt-1 text-xs text-gray-500">The current password is verified before the database is re-encrypted.</p>
        <div className="mt-3 space-y-2">
          <input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Current master password" className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
          <input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New master password" className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
          <input type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder="Confirm new master password" className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
          <button type="button" disabled={busy || !currentPassword} onClick={() => void changePassword()} className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Change password</button>
        </div>
      </div>
      {message && <p role="status" className="mt-4 rounded bg-gray-50 p-2 text-sm text-gray-700">{message}</p>}
    </section>
  </div>;
}
