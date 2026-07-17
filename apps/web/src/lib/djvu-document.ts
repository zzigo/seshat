type DjVuSize = { width: number; height: number; dpi: number };
export type DjVuTextZone = { x: number; y: number; width: number; height: number; text: string };

type DjVuTask = { run(): Promise<unknown> };
type DjVuWorker = {
  createDocument(buffer: ArrayBuffer, options?: Record<string, unknown>): Promise<void>;
  doc: Record<string, (...args: unknown[]) => DjVuTask> & { getPage(page: number): Record<string, (...args: unknown[]) => DjVuTask> };
  run(...tasks: DjVuTask[]): Promise<unknown>;
  cancelTask(task: Promise<unknown>): void;
  terminate(): void;
};
type DjVuGlobal = { Worker: new (libraryUrl?: string) => DjVuWorker; VERSION: string };

declare global { interface Window { DjVu?: DjVuGlobal } }

let libraryPromise: Promise<DjVuGlobal> | null = null;
const loadLibrary = () => {
  if (window.DjVu) return Promise.resolve(window.DjVu);
  if (libraryPromise) return libraryPromise;
  libraryPromise = new Promise<DjVuGlobal>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/djvu/djvu.js'; script.async = true;
    script.addEventListener('load', () => window.DjVu ? resolve(window.DjVu) : reject(new Error('DjVu.js did not initialize.')));
    script.addEventListener('error', () => reject(new Error('DjVu.js could not be loaded.')));
    document.head.appendChild(script);
  });
  return libraryPromise;
};

export type DjVuPageAdapter = {
  getViewport(options: { scale: number }): { width: number; height: number };
  render(options: { canvasContext: CanvasRenderingContext2D }): { promise: Promise<void>; cancel(): void };
  getDjVuTextZones(): DjVuTextZone[];
};

export type DjVuDocumentAdapter = {
  numPages: number;
  getPage(pageNumber: number): Promise<DjVuPageAdapter>;
  destroy(): Promise<void>;
};

export const openDjVuDocument = async (url: string): Promise<DjVuDocumentAdapter> => {
  const [library, response] = await Promise.all([loadLibrary(), fetch(url, { credentials: 'same-origin', cache: 'no-store' })]);
  if (!response.ok) throw new Error(`DjVu original could not be loaded (${response.status}).`);
  const worker = new library.Worker('/vendor/djvu/djvu.js');
  await worker.createDocument(await response.arrayBuffer());
  const [sizes, quantity] = await Promise.all([
    worker.doc.getPagesSizes().run() as Promise<DjVuSize[]>,
    worker.doc.getPagesQuantity().run() as Promise<number>,
  ]);
  let destroyed = false;
  return {
    numPages: Number(quantity) || sizes.length,
    async getPage(pageNumber) {
      const size = sizes[pageNumber - 1];
      if (!size) throw new Error(`DjVu page ${pageNumber} does not exist.`);
      let zones: DjVuTextZone[] = [];
      const cssRatio = 96 / Math.max(72, Number(size.dpi) || 300);
      return {
        getViewport: ({ scale }) => ({ width: size.width * cssRatio * scale, height: size.height * cssRatio * scale }),
        getDjVuTextZones: () => zones,
        render: ({ canvasContext }) => {
          let cancelled = false;
          const task = worker.run(
            worker.doc.getPage(pageNumber).getImageData(),
            worker.doc.getPage(pageNumber).getNormalizedTextZones(),
          );
          const promise = task.then((result) => {
            if (cancelled || destroyed) return;
            const [imageData, textZones] = result as [ImageData, DjVuTextZone[] | null];
            zones = Array.isArray(textZones) ? textZones.map((zone) => ({
              ...zone, x: zone.x * cssRatio, y: zone.y * cssRatio,
              width: zone.width * cssRatio, height: zone.height * cssRatio,
            })) : [];
            const source = document.createElement('canvas'); source.width = imageData.width; source.height = imageData.height;
            source.getContext('2d', { alpha: false })?.putImageData(imageData, 0, 0);
            const target = canvasContext.canvas; canvasContext.save(); canvasContext.clearRect(0, 0, target.width, target.height);
            canvasContext.drawImage(source, 0, 0, target.width, target.height); canvasContext.restore();
            source.width = 1; source.height = 1;
          });
          return { promise, cancel: () => { cancelled = true; worker.cancelTask(task); } };
        },
      };
    },
    async destroy() { destroyed = true; worker.terminate(); },
  };
};
