import { useEffect, useState } from 'react';
import { useEditor } from '../../store/editor';

export function Toast() {
  const toast = useEditor((s) => s.toast);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 2200);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className={`toast ${visible ? 'show' : ''}`} role="status">
      {toast.text}
    </div>
  );
}

export const notify = (text: string) => useEditor.getState().notify(text);
