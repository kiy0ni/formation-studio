// Windows only: puts the app icon and version details inside the .exe.
// resedit is pure JavaScript, so this works when building on a Mac (no Wine needed).
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const ResEdit = await import('resedit');
  const { default: pngToIco } = await import('png-to-ico');

  const info = context.packager.appInfo;
  const exePath = path.join(context.appOutDir, `${info.productFilename}.exe`);
  const sizesDir = path.join(__dirname, 'icon-sizes');
  const pngs = [16, 24, 32, 48, 64, 128, 256].map((s) => path.join(sizesDir, `icon-${s}.png`)).filter((f) => fs.existsSync(f));

  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);

  if (pngs.length) {
    const iconFile = ResEdit.Data.IconFile.from(await pngToIco(pngs));
    const group = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries)[0];
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
      res.entries,
      group ? group.id : 1,
      group ? group.lang : 1033,
      iconFile.icons.map((i) => i.data),
    );
  }

  const [versionInfo] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (versionInfo) {
    const [major = 1, minor = 0, patch = 0] = info.version.split('.').map(Number);
    const lang = versionInfo.getAllLanguagesForStringValues()[0] ?? { lang: 1033, codepage: 1200 };
    versionInfo.setFileVersion(major, minor, patch, 0, lang.lang);
    versionInfo.setProductVersion(major, minor, patch, 0, lang.lang);
    versionInfo.setStringValues(lang, {
      FileDescription: 'Lineup',
      ProductName: 'Lineup',
      CompanyName: 'Lineup',
      LegalCopyright: 'Lineup',
      OriginalFilename: `${info.productFilename}.exe`,
      InternalName: 'Lineup',
    });
    versionInfo.outputToResourceEntries(res.entries);
  }

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log('  • icône et version appliquées à', path.basename(exePath));
};
