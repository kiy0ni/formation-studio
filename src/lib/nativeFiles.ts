import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = reject;
    r.readAsDataURL(blob);
  });

/**
 * Android app: WebViews can't download files, so exports are written to the app cache and handed
 * to the system share sheet (save to Files / Drive, send by WhatsApp, Instagram…).
 */
export async function saveAndShare(name: string, blob: Blob) {
  const { uri } = await Filesystem.writeFile({
    path: `exports/${name}`,
    data: await toBase64(blob),
    directory: Directory.Cache,
    recursive: true,
  });
  try {
    await Share.share({ title: name, files: [uri], dialogTitle: 'Enregistrer ou partager' });
  } catch {
    /* sheet closed without choosing */
  }
}
