import fs from 'fs';

export const TEXT_PREVIEW_CHARACTER_LIMIT = 50_000;

// UTF-8 uses at most four bytes per Unicode code point. Reading this bounded
// prefix avoids loading multi-GB logs just to return a short browser preview.
const MAX_UTF8_BYTES_PER_CHARACTER = 4;

export async function readTextFilePreview(
  filePath: string,
  characterLimit = TEXT_PREVIEW_CHARACTER_LIMIT,
): Promise<{ content: string; truncated: boolean }> {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const stats = await handle.stat();
    const byteLimit = characterLimit * MAX_UTF8_BYTES_PER_CHARACTER + 4;
    const bytesToRead = Math.min(stats.size, byteLimit);
    const buffer = Buffer.allocUnsafe(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
    const decoded = buffer.toString('utf8', 0, bytesRead);

    return {
      content: decoded.slice(0, characterLimit),
      truncated: decoded.length > characterLimit || bytesRead < stats.size,
    };
  } finally {
    await handle.close();
  }
}
