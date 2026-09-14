import { useMemo } from 'react';
import { Toast } from './components/common/Toast';
import { EditorPage } from './components/editor/EditorPage';
import { JoinPage } from './components/library/JoinPage';
import { LibraryPage } from './components/library/LibraryPage';
import { MovedNotice } from './components/MovedNotice';
import { PrintPage } from './components/PrintPage';
import { UpdateNotice } from './components/UpdateNotice';
import { parseRoute, useHash } from './lib/router';

export default function App() {
  const hash = useHash();
  const route = useMemo(() => parseRoute(hash), [hash]);
  return (
    <>
      {route.name === 'library' && <LibraryPage tab={route.tab} create={route.create} />}
      {route.name === 'editor' && <EditorPage key={route.id} id={route.id} />}
      {route.name === 'join' && <JoinPage room={route.room} accessKey={route.key} />}
      {route.name === 'print' && <PrintPage id={route.id} />}
      <Toast />
      <UpdateNotice />
      <MovedNotice />
    </>
  );
}
