import { Readable } from 'stream';
const Busboy = require('@/vendor/busboy');

type Limits = {
  fieldNameSize?: number;
  fieldSize?: number;
  fields?: number;
  fileSize?: number;
  files?: number;
  headerPairs?: number;
  parts?: number;
};

type MultipartHandlers = {
  limits?: Limits;
  onField?: (name: string, value: string) => void | Promise<void>;
  onFile?: (file: {
    index: number;
    fieldName: string;
    filename: string;
    mimeType: string;
    encoding: string;
    stream: NodeJS.ReadableStream;
  }) => void | Promise<void>;
};

export async function consumeMultipartRequest(request: Request, handlers: MultipartHandlers) {
  if (!request.body) {
    throw new Error('请求体为空');
  }

  const busboy = Busboy({
    headers: Object.fromEntries(request.headers.entries()),
    limits: handlers.limits,
    // Browsers encode multipart filename parameters as UTF-8 bytes. Busboy's
    // legacy default is latin1, which turns Chinese names into mojibake such as
    // "åé¡¹..." before the upload handler ever sees them.
    defParamCharset: 'utf8',
  });

  const pending: Promise<void>[] = [];
  let fileIndex = 0;

  await new Promise<void>((resolve, reject) => {
    busboy.on('field', (name: string, value: string) => {
      if (!handlers.onField) return;
      pending.push(Promise.resolve(handlers.onField(name, value)));
    });

    busboy.on('file', (fieldName: string, stream: NodeJS.ReadableStream, info: { filename: string; mimeType: string; encoding: string }) => {
      if (!handlers.onFile) {
        stream.resume();
        return;
      }

      pending.push(
        Promise.resolve(
          handlers.onFile({
            index: fileIndex++,
            fieldName,
            filename: info.filename,
            mimeType: info.mimeType,
            encoding: info.encoding,
            stream,
          }),
        ),
      );
    });

    busboy.once('error', reject);
    busboy.once('partsLimit', () => reject(new Error('上传内容过多，请分批上传')));
    busboy.once('filesLimit', () => reject(new Error('上传文件数量超出限制，请分批上传')));
    busboy.once('fieldsLimit', () => reject(new Error('上传字段数量超出限制')));
    busboy.once('finish', () => resolve());

    Readable.fromWeb(request.body as any).pipe(busboy);
  });

  await Promise.all(pending);
}
