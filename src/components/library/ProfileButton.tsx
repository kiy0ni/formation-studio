import { useState } from 'react';
import { displayColor, displayName } from '../../collab/client';
import { initials } from '../../lib/geometry';
import { Icon } from '../common/Icon';
import { ColorSwatches, Modal } from '../common/ui';

export function ProfileButton() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(displayName());
  const [color, setColor] = useState(displayColor());
  return (
    <>
      <button className="avatar-btn" style={{ background: color }} title={`Profil : ${name}`} onClick={() => setOpen(true)}>
        {initials(name)}
      </button>
      {open && (
        <Modal
          title="Votre profil"
          onClose={() => setOpen(false)}
          footer={
            <button
              className="btn primary"
              onClick={() => {
                localStorage.setItem('fs-name', name.trim() || 'Chorégraphe');
                localStorage.setItem('fs-color', color);
                setOpen(false);
              }}
            >
              <Icon name="check" /> Enregistrer
            </button>
          }
        >
          <p className="hint">Votre nom et votre couleur apparaissent pour les autres pendant la collaboration en temps réel.</p>
          <label className="field">
            <span className="field-label">Nom affiché</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="field">
            <span className="field-label">Couleur</span>
            <ColorSwatches value={color} onChange={setColor} />
          </div>
        </Modal>
      )}
    </>
  );
}
