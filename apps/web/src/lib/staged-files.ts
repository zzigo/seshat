export const stagedFilesScript = String.raw`
const openSeshatDatabase = () => new Promise((resolve, reject) => {
  const request = indexedDB.open('seshat-intake', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'id' });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const readSeshatBatch = async (batch) => {
  const db = await openSeshatDatabase();
  const transaction = db.transaction('files', 'readonly');
  const request = transaction.objectStore('files').getAll();
  const rows = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result.filter((row) => row.batch === batch));
    request.onerror = () => reject(request.error);
  });
  db.close();
  return rows;
};
`;
