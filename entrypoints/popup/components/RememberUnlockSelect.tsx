import { REMEMBER_UNLOCK_OPTIONS } from '@/lib/constants';

interface Props {
  id: string;
  value: number;
  onChange: (durationMs: number) => void;
  disabled?: boolean;
}

export function RememberUnlockSelect({ id, value, onChange, disabled = false }: Props) {
  return <div>
    <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-700">
      Remember unlock for
    </label>
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(Number(event.target.value))}
      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
    >
      {REMEMBER_UNLOCK_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
    <p className="mt-1 text-xs text-gray-500">
      The vault locks after this much inactivity. Remembered unlock is cleared when Chrome closes.
    </p>
  </div>;
}
