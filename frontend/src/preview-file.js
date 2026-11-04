export const PREVIEW_FILE_LIMIT = 128 * 1024 * 1024;
export async function readPreviewFile(client, path, size) {
  if (!Number.isSafeInteger(size) || size < 0 || size > PREVIEW_FILE_LIMIT)
    throw Error('Preview file exceeds 128 MiB');
  const response = await client.request(client.w('file', {path}));
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== size) throw Error('Preview file size changed');
  return bytes;
}
