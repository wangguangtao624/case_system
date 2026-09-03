'use client';

import { useCallback, useEffect, useState, type CSSProperties, type MouseEvent, type WheelEvent } from 'react';

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 5;

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

export function ReportLogViewer({
  html,
  className,
  style,
}: {
  html: string;
  className?: string;
  style?: CSSProperties;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState('报告图片');
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const resetView = useCallback(() => {
    setZoom(1);
    setPosition({ x: 0, y: 0 });
    setDragging(false);
  }, []);

  const closeViewer = useCallback(() => {
    setImageUrl(null);
    setImageSize(null);
    resetView();
  }, [resetView]);

  const changeZoom = useCallback((nextZoom: number) => {
    const normalizedZoom = clampZoom(nextZoom);
    setZoom(normalizedZoom);
    if (normalizedZoom <= 1) setPosition({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    if (!imageUrl) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeViewer();
      if (event.key === '+' || event.key === '=') changeZoom(zoom + 0.25);
      if (event.key === '-') changeZoom(zoom - 0.25);
      if (event.key === '0') resetView();
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [changeZoom, closeViewer, imageUrl, resetView, zoom]);

  const handleDrag = useCallback((event: globalThis.MouseEvent) => {
    if (!dragging) return;
    setPosition({ x: event.clientX - dragStart.x, y: event.clientY - dragStart.y });
  }, [dragStart, dragging]);

  const stopDragging = useCallback(() => setDragging(false), []);

  useEffect(() => {
    if (!dragging) return;
    document.addEventListener('mousemove', handleDrag);
    document.addEventListener('mouseup', stopDragging);
    return () => {
      document.removeEventListener('mousemove', handleDrag);
      document.removeEventListener('mouseup', stopDragging);
    };
  }, [dragging, handleDrag, stopDragging]);

  const openImage = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLImageElement) || !target.src) return;
    event.preventDefault();
    setImageUrl(target.src);
    setImageName(target.alt || target.title || '报告图片');
    setImageSize(null);
    resetView();
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    changeZoom(zoom + (event.deltaY > 0 ? -0.12 : 0.12));
  };

  return (
    <>
      <div
        className={className}
        style={style}
        onDoubleClick={openImage}
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {imageUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
          className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden"
          style={{ backgroundColor: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(3px)' }}
          onClick={closeViewer}
          onWheel={handleWheel}
        >
          <div className="absolute left-5 top-4 z-10 text-sm text-white/90">
            <div className="max-w-[42vw] truncate font-medium">{imageName}</div>
            {imageSize && <div className="mt-1 text-xs text-white/60">原始尺寸：{imageSize.width} × {imageSize.height}px</div>}
          </div>

          <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
            <button type="button" className="h-9 w-9 rounded-full text-lg text-white transition-colors hover:bg-white/15" onClick={(event) => { event.stopPropagation(); changeZoom(zoom + 0.25); }} title="放大">+</button>
            <span className="min-w-[54px] text-center text-sm text-white">{Math.round(zoom * 100)}%</span>
            <button type="button" className="h-9 w-9 rounded-full text-lg text-white transition-colors hover:bg-white/15" onClick={(event) => { event.stopPropagation(); changeZoom(zoom - 0.25); }} title="缩小">−</button>
            <button type="button" className="rounded-full px-3 py-1.5 text-sm text-white transition-colors hover:bg-white/15" onClick={(event) => { event.stopPropagation(); resetView(); }} title="重置">1:1</button>
            <button type="button" className="h-9 w-9 rounded-full text-xl text-white transition-colors hover:bg-white/15" onClick={closeViewer} title="关闭" aria-label="关闭图片预览">×</button>
          </div>

          <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 text-xs text-white/60">
            滚轮缩放 | 拖拽移动 | Esc 或点击空白处关闭
          </div>

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={imageName}
            className="max-h-[84vh] max-w-[90vw] select-none object-contain"
            style={{
              transform: `scale(${zoom}) translate(${position.x / zoom}px, ${position.y / zoom}px)`,
              transformOrigin: 'center center',
              transition: dragging ? 'none' : 'transform 0.15s ease',
              cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in',
            }}
            onLoad={(event) => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => { event.stopPropagation(); changeZoom(zoom === 1 ? 2 : 1); }}
            onMouseDown={(event) => {
              if (zoom <= 1) return;
              event.preventDefault();
              setDragging(true);
              setDragStart({ x: event.clientX - position.x, y: event.clientY - position.y });
            }}
            draggable={false}
          />
        </div>
      )}
    </>
  );
}
