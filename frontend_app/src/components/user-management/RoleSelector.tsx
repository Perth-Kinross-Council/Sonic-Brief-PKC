// React import not needed with automatic JSX runtime

export function RoleSelector({ value, onChange }: { value: string; onChange: (role: string) => void }) {
  return (
    <select
      title="Change user role"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="border p-1 rounded"
    >
      <option value="admin">Admin</option>
      <option value="power_user">Power User</option>
      <option value="standard">Standard</option>
    </select>
  );
}
