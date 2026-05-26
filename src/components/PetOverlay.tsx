import { useCallback, useEffect, useRef, useState } from 'react';

import type { OverlayState, PetAnimation } from '../shared/types';

function getOverlayTitle(state: OverlayState): string {
  if (state.status === 'hidden' || state.status === 'idle') return 'Ready';
  return state.message;
}

function getStatusText(state: OverlayState): { show: boolean; text: string } {
  if (state.status === 'hidden' || state.status === 'idle') return { show: false, text: '' };
  return { show: true, text: getOverlayTitle(state) };
}

export function PetOverlay(): JSX.Element {
  const [anim, setAnim] = useState<PetAnimation>('idle');
  const [waveAnim, setWaveAnim] = useState<PetAnimation | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ show: boolean; text: string }>({ show: false, text: '' });
  const [petId, setPetId] = useState('yorha-sit-2b');
  const [gifError, setGifError] = useState(false);
  const waveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const jumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    document.body.classList.add('overlay-mode');
    return () => document.body.classList.remove('overlay-mode');
  }, []);

  useEffect(() => {
    void window.voskFlow.getBootstrap().then((payload) => {
      setPetId(payload.settings.petSelection);
    });
  }, []);

  useEffect(() => {
    const unsubState = window.voskFlow.onOverlayState((state: OverlayState) => {
      setStatusMsg(getStatusText(state));

      if (state.status === 'recording') {
        setAnim('running-left');
        if (runIntervalRef.current) clearInterval(runIntervalRef.current);
        runIntervalRef.current = setInterval(() => {
          setAnim((prev) => (prev === 'running-left' ? 'running-right' : 'running-left'));
        }, 600);
      } else {
        if (runIntervalRef.current) {
          clearInterval(runIntervalRef.current);
          runIntervalRef.current = null;
        }
        if (state.status === 'processing') {
          setAnim('waiting');
        } else if (state.status === 'done' || state.status === 'error') {
          setAnim('jumping');
          if (jumpTimerRef.current) clearTimeout(jumpTimerRef.current);
          jumpTimerRef.current = setTimeout(() => setAnim('idle'), 1600);
        } else {
          setAnim('idle');
        }
      }
    });

    const unsubPet = window.voskFlow.onPetAnimation((nextAnim: PetAnimation) => {
      if (!waveAnimRef.current && runIntervalRef.current === null) {
        setAnim(nextAnim);
      }
    });

    const unsubPetSelection = window.voskFlow.onPetSelectionChanged((newPetId: string) => {
      setPetId(newPetId);
    });

    return () => {
      unsubState();
      unsubPet();
      unsubPetSelection();
      if (waveTimerRef.current) clearTimeout(waveTimerRef.current);
      if (runIntervalRef.current) clearInterval(runIntervalRef.current);
      if (jumpTimerRef.current) clearTimeout(jumpTimerRef.current);
    };
  }, []);

  const waveAnimRef = useRef<PetAnimation | null>(null);
  waveAnimRef.current = waveAnim;

  const handleClick = useCallback(() => {
    setWaveAnim('waving');
    setAnim('waving');
    if (waveTimerRef.current) clearTimeout(waveTimerRef.current);
    waveTimerRef.current = setTimeout(() => {
      setWaveAnim(null);
      waveAnimRef.current = null;
    }, 2000);
  }, []);

  const currentAnim = waveAnim ?? anim;
  const gifPath = petId ? `pet://${petId}/${currentAnim}.gif` : '';

  useEffect(() => {
    setGifError(false);
  }, [gifPath]);

  return (
    <div className="pet-overlay">
      {gifError ? (
        <div className="pet-gif-error">pet</div>
      ) : (
        <img
          key={gifPath}
          className="pet-overlay-gif"
          src={gifPath}
          alt="pet"
          draggable={false}
          onClick={handleClick}
          onError={() => setGifError(true)}
        />
      )}
      {statusMsg.show && (
        <div className="pet-status-text">{statusMsg.text}</div>
      )}
    </div>
  );
}
