import { useCallback, useEffect, useState } from 'react';

import type { AppSettings, PetDefinition, PetAnimation } from '../shared/types';

const ANIMATIONS: PetAnimation[] = ['idle', 'running', 'running-left', 'running-right', 'waiting', 'jumping', 'review', 'failed', 'waving'];

type PetTabProps = {
  settings: AppSettings;
  onSettingsChange: (next: AppSettings) => Promise<void>;
};

export function PetTab({ settings, onSettingsChange }: PetTabProps): JSX.Element {
  const [pets, setPets] = useState<PetDefinition[]>([]);
  const [previewAnim, setPreviewAnim] = useState<PetAnimation>('idle');
  const selectedPet = settings.petSelection;

  const loadPets = useCallback(async () => {
    const list = await window.voskFlow.listAvailablePets();
    setPets(list);
    if (list.length > 0 && !list.some((p) => p.id === selectedPet)) {
      await onSettingsChange({ ...settings, petSelection: list[0].id });
    }
  }, [selectedPet, settings, onSettingsChange]);

  useEffect(() => {
    void loadPets();
  }, [loadPets]);

  const handleSelect = async (petId: string) => {
    await onSettingsChange({ ...settings, petSelection: petId });
  };

  const handleImport = async () => {
    const importedId = await window.voskFlow.importPetFromZip();
    if (importedId) {
      await loadPets();
      await onSettingsChange({ ...settings, petSelection: importedId });
    }
  };

  const handleRemove = async (petId: string) => {
    await window.voskFlow.removePet(petId);
    const updated = await window.voskFlow.listAvailablePets();
    setPets(updated);
    if (settings.petSelection === petId && updated.length > 0) {
      await onSettingsChange({ ...settings, petSelection: updated[0].id });
    }
  };

  const petOptions = pets.map((p) => p.displayName || p.id);
  const selectedName = pets.find((p) => p.id === selectedPet)?.displayName || selectedPet;

  return (
    <section className="page page-pet">
      <div className="page-intro settings-intro">
        <h2 className="page-heading">Pet</h2>
        <p className="page-subcopy">Choose a companion pet to show your AI status in a transparent overlay window.</p>
      </div>

      <div className="settings-stack">
        <article className="settings-card">
          <p className="settings-title">Pet selection</p>
          <p className="settings-description">Pick which pet to display in the overlay window.</p>
          {petOptions.length > 0 && (
            <div className="seg-ctrl">
              {petOptions.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={`seg-btn${name === selectedName ? ' on' : ''}`}
                  onClick={() => {
                    const pet = pets.find((p) => p.displayName === name || p.id === name);
                    if (pet) handleSelect(pet.id);
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
          {pets.length === 0 && (
            <p className="settings-description" style={{ marginTop: 8, color: 'var(--muted-foreground)' }}>
              No pets found. Import one from a ZIP file to get started.
            </p>
          )}
        </article>

        <article className="settings-card">
          <p className="settings-title">Preview</p>
          <p className="settings-description">Preview the selected pet animation.</p>
          {selectedPet && (
            <div className="pet-preview">
              <img
                className="pet-preview-gif"
                src={`pet://${selectedPet}/${previewAnim}.gif`}
                alt={selectedPet}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
              <div className="seg-ctrl pet-preview-controls">
                {ANIMATIONS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={`seg-btn${a === previewAnim ? ' on' : ''}`}
                    onClick={() => setPreviewAnim(a)}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
          )}
        </article>

        <article className="settings-card">
          <p className="settings-title">Browse pets</p>
          <p className="settings-description">Find and download pet ZIP files from the Codex Pets website, then import them above.</p>
          <button className="secondary-button pet-browse-btn" type="button" onClick={() => void window.voskFlow.openUrl('https://codex-pets.net/#/')}>
            Browse Codex Pets
          </button>
        </article>

        <article className="settings-card">
          <p className="settings-title">Import from ZIP</p>
          <p className="settings-description">Import a new pet from a ZIP archive containing GIF files. Filenames should follow the pattern <code>{'{pet-id}-{animation}.gif'}</code>.</p>
          <button className="secondary-button pet-import-btn" type="button" onClick={() => void handleImport()}>
            Import Pet from ZIP
          </button>
        </article>

        {pets.filter((p) => !p.builtIn).length > 0 && (
          <article className="settings-card">
            <p className="settings-title">Remove custom pets</p>
            <p className="settings-description">Remove custom-imported pets. Built-in pets are protected.</p>
            <div className="pet-remove-list">
              {pets.filter((p) => !p.builtIn).map((pet) => (
                <div key={pet.id} className="pet-remove-row">
                  <span>{pet.displayName || pet.id}</span>
                  <button
                    className="danger-button pet-remove-btn"
                    type="button"
                    onClick={() => void handleRemove(pet.id)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </article>
        )}
      </div>
    </section>
  );
}
