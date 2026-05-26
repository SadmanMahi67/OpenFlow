type SegmentedControlProps = {
  options: string[];
  value: string;
  onChange: (value: string) => void;
};

export function SegmentedControl({ options, value, onChange }: SegmentedControlProps): JSX.Element {
  return (
    <div className="seg-ctrl">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={`seg-btn${option === value ? ' on' : ''}`}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
