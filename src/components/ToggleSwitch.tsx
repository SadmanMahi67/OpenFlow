type ToggleSwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description: string;
};

export function ToggleSwitch({ checked, onChange, label, description }: ToggleSwitchProps): JSX.Element {
  return (
    <div className="toggle-wrap">
      <div className="toggle-info">
        <div className="toggle-title">{label}</div>
        <div className="toggle-sub">{description}</div>
      </div>
      <button
        type="button"
        className={`toggle-switch${checked ? ' is-on' : ''}`}
        aria-pressed={checked}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </div>
  );
}
