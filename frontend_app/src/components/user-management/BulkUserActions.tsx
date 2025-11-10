// React import not needed with automatic JSX runtime

export function BulkUserActions({ selected, onBulkDelete, onBulkRoleChange }: {
  selected: string[];
  onBulkDelete: () => void;
  onBulkRoleChange: (role: string) => void;
}) {
  if (selected.length === 0) return null;
  return (
    <div className="flex gap-2 mb-2">
      <button className="border rounded px-2 py-1 bg-red-100 hover:bg-red-200" onClick={onBulkDelete}>
        Delete Selected
      </button>
      <select
        className="border p-1 rounded"
        onChange={e => onBulkRoleChange(e.target.value)}
        defaultValue=""
      >
        <option value="">Bulk Change Role</option>
        <option value="admin">Admin</option>
        <option value="power_user">Power User</option>
        <option value="standard">Standard</option>
      </select>
    </div>
  );
}
