/** An on/off switch with its label. */
export function Switch({ id, checked, label, onChange }: { id: string; checked: boolean; label: string; onChange: (value: boolean) => void }) {
  return (
    <div className="switch-row">
      <label htmlFor={id}>{label}</label>
      <button id={id} type="button" role="switch" aria-checked={checked} className="switch" onClick={() => onChange(!checked)}>
        <span className="switch-knob" />
      </button>
    </div>
  );
}
