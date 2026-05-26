type MicButtonProps = {
  status: 'idle' | 'recording' | 'processing' | 'done' | 'error';
  onClick: () => void;
};

export function MicButton({ status, onClick }: MicButtonProps): JSX.Element {
  const isRecording = status === 'recording';
  const isProcessing = status === 'processing';

  const micD = isRecording
    ? 'M18 6L6 18 M6 6l12 12'
    : 'M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z M19 10v2a7 7 0 0 1-14 0v-2 M12 19v3 M8 22h8';

  const color = isRecording
    ? { color: '#f87171' }
    : isProcessing
      ? { color: '#fb923c' }
      : {};

  return (
    <button
      type="button"
      className={`mic-btn${isRecording ? ' recording' : ''}`}
      onClick={onClick}
      style={color}
    >
      {isProcessing ? (
        <svg className="ic spin" width="22" height="22" viewBox="0 0 24 24">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
      ) : (
        <svg className="ic" width="22" height="22" viewBox="0 0 24 24">
          <path d={micD} />
        </svg>
      )}
    </button>
  );
}
