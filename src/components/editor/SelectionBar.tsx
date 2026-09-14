import { transform, type TransformKind } from '../../lib/actions';
import { useEditor } from '../../store/editor';
import { Icon, type IconName } from '../common/Icon';
import { editableFormationId } from './editorActions';

/** Quick actions right where the selection is: select, then one tap. */
export function SelectionBar() {
  const selected = useEditor((s) => s.selected);
  const playing = useEditor((s) => s.playing);
  const readOnly = useEditor((s) => s.readOnly);
  const total = useEditor((s) => Object.keys(s.doc!.dancers).length);
  if (!selected.length || playing || readOnly) return null;

  const run = (label: string, kind: TransformKind) => {
    const fid = editableFormationId();
    if (fid) useEditor.getState().update(label, (d) => transform(d, fid, useEditor.getState().selected, kind));
  };
  const action = (icon: IconName, label: string, onClick: () => void, disabled = false) => (
    <button onClick={onClick} disabled={disabled} title={label}>
      <Icon name={icon} size={19} />
      <span>{label}</span>
    </button>
  );

  return (
    <div className="selbar" role="toolbar" aria-label="Sélection">
      <span className="selbar-count" title="Sélectionnés">
        {selected.length}
      </span>
      {action('wand', 'Formes', () => useEditor.setState({ tab: 'presets', sheetOpen: true }))}
      {action('flipH', 'Miroir', () => run('Miroir', 'mirrorX'))}
      {action('alignH', 'Ligne', () => run('En ligne', 'alignH'))}
      {action('distH', 'Répartir', () => run('Répartir', 'distH'), selected.length < 3)}
      {selected.length < total && action('users', 'Tous', () => useEditor.getState().select(Object.keys(useEditor.getState().doc!.dancers)))}
      <button className="selbar-close" onClick={() => useEditor.getState().select([])} aria-label="Désélectionner" title="Désélectionner">
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
