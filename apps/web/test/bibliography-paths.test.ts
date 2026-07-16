import assert from 'node:assert/strict';
import test from 'node:test';
import { extractBibAttachmentPath, mapBibAttachment, storageRootFor } from '../src/lib/bibliography-paths';
import { wasabiUnicodePathForms } from '../src/lib/wasabi-settings';

test('maps the privileged Zotero libros root without showing libros', () => {
  const mapped = mapBibAttachment(
    '/Users/zztt/My Drive/libros/artistic research/dissertation/8.6 transference/Chiu et al._2024.pdf',
    { email: 'lucianoazzigotti@gmail.com', name: 'Luciano' },
  );
  assert.deepEqual(mapped?.directories, ['artistic research', 'dissertation', '8.6 transference']);
  assert.equal(mapped?.objectKey, 'zzttuntref/libros/artistic research/dissertation/8.6 transference/Chiu et al._2024.pdf');
  assert.equal(mapped?.privilegedRoot, true);
});

test('isolates ordinary users below lseshat and hides the physical prefix', () => {
  const mapped = mapBibAttachment('/home/ana/libros/analysis/source.pdf', { email: 'Ana.Student@example.edu' });
  assert.deepEqual(mapped?.directories, ['analysis']);
  assert.equal(mapped?.objectKey, 'zzttuntref/lseshat/ana.student/analysis/source.pdf');
  assert.equal(storageRootFor({ email: 'Ana.Student@example.edu' }).privileged, false);
});

test('understands Zotero attachment metadata and rejects unsupported files', () => {
  assert.equal(extractBibAttachmentPath('PDF:/Users/zztt/My Drive/libros/a/b.pdf:application/pdf'), '/Users/zztt/My Drive/libros/a/b.pdf');
  assert.equal(extractBibAttachmentPath('/Users/zztt/My Drive/libros/a/image.png'), null);
});

test('resolves Zotero relative paths below a user-configured Wasabi library root', () => {
  const mapped = mapBibAttachment(
    '/Users/zztt/Zotero/storage/libros/history/Plato_Republic.pdf',
    { email:'lucianoazzigotti@gmail.com' },
    'zzttuntref/migrated-zotero',
  );
  assert.equal(mapped?.relativePath, 'history/Plato_Republic.pdf');
  assert.equal(mapped?.objectKey, 'zzttuntref/migrated-zotero/history/Plato_Republic.pdf');
  assert.equal(mapped?.storageRoot, 'zzttuntref/migrated-zotero');
});

test('queries both composed and macOS-decomposed Wasabi paths', () => {
  const forms = wasabiUnicodePathForms('zzttuntref/libros/acústica');
  assert.deepEqual(forms, ['zzttuntref/libros/acústica', 'zzttuntref/libros/acústica']);
  assert.equal(forms[0].normalize('NFC'), forms[1].normalize('NFC'));
});

test('maps Safari WebArchive attachments as preserved documents', () => {
  const mapped = mapBibAttachment('/Users/zztt/My Drive/libros/web/Signal and Form.webarchive', { email:'lucianoazzigotti@gmail.com' });
  assert.equal(mapped?.filename, 'Signal and Form.webarchive');
  assert.equal(mapped?.relativePath, 'web/Signal and Form.webarchive');
});

test('maps DjVu attachments as preserved documents', () => {
  const mapped = mapBibAttachment('/Users/zztt/My Drive/libros/scores/Old Treatise.djvu', { email:'lucianoazzigotti@gmail.com' });
  assert.equal(mapped?.filename, 'Old Treatise.djvu');
  assert.equal(mapped?.relativePath, 'scores/Old Treatise.djvu');
});
