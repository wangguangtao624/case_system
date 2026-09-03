'use client';

import { useRef, useState } from 'react';

type DownloadState = 'idle' | 'preparing' | 'downloading' | 'started' | 'success' | 'error';

const DIRECT_DOWNLOAD_THRESHOLD = 64 * 1024 * 1024;

function getFilename(header: string | null) {
  const encoded = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded); } catch { /* use fallback */ }
  }
  return '离线报告.zip';
}

export function ReportDownloadButton({ href, compact = false }: { href: string; compact?: boolean }) {
  const [state, setState] = useState<DownloadState>('idle');
  const [progress, setProgress] = useState<number | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const download = async () => {
    if (state === 'preparing' || state === 'downloading') return;
    if (resetTimer.current) clearTimeout(resetTimer.current);
    setState('preparing');
    setProgress(null);
    try {
      const response = await fetch(href);
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error || `下载失败（HTTP ${response.status}）`);
      }
      const total = Number(response.headers.get('content-length')) || 0;
      const estimated = Number(response.headers.get('x-report-estimated-bytes')) || total;
      const reader = response.body?.getReader();
      if (!reader) throw new Error('浏览器不支持流式下载');
      if (estimated >= DIRECT_DOWNLOAD_THRESHOLD) {
        // 大报告交给浏览器原生下载器直接写磁盘，避免 JS chunks + Blob 产生多份内存副本。
        await reader.cancel();
        const anchor = document.createElement('a');
        anchor.href = href;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setState('started');
        setProgress(null);
        resetTimer.current = setTimeout(() => setState('idle'), 8000);
        return;
      }
      const chunks: Uint8Array[] = [];
      let received = 0;
      setState('downloading');
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        setProgress(total > 0 ? Math.min(100, Math.round(received / total * 100)) : null);
      }
      const blob = new Blob(chunks as BlobPart[], { type: response.headers.get('content-type') || 'text/html;charset=utf-8' });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = getFilename(response.headers.get('content-disposition'));
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setProgress(100);
      setState('success');
      resetTimer.current = setTimeout(() => { setState('idle'); setProgress(null); }, 3500);
    } catch (error) {
      console.error('Download report error:', error);
      setState('error');
      resetTimer.current = setTimeout(() => { setState('idle'); setProgress(null); }, 5000);
    }
  };

  const label = state === 'preparing' ? '正在生成报告…'
    : state === 'downloading' ? `正在下载${progress === null ? '…' : ` ${progress}%`}`
      : state === 'started' ? '已交给浏览器下载 ✓'
      : state === 'success' ? '下载完成 ✓'
        : state === 'error' ? '下载失败，重试'
          : compact ? '下载离线包' : '下载离线报告包';

  return (
    <div className="inline-flex flex-col items-stretch gap-1" aria-live="polite">
      <button
        type="button"
        onClick={download}
        disabled={state === 'preparing' || state === 'downloading'}
        className={`${compact ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'} relative overflow-hidden rounded-lg border disabled:cursor-wait`}
        style={{
          borderColor: state === 'error' ? '#FCA5A5' : compact ? '#93C5FD' : '#1677FF',
          color: state === 'error' ? '#B91C1C' : compact ? '#1D4ED8' : '#FFFFFF',
          backgroundColor: compact ? '#FFFFFF' : state === 'success' ? '#059669' : '#1677FF',
          minWidth: compact ? '118px' : '148px',
        }}
      >
        {state === 'downloading' && progress !== null && <span className="absolute inset-y-0 left-0 opacity-20" style={{ width: `${progress}%`, backgroundColor: '#2563EB' }} />}
        <span className="relative">{label}</span>
      </button>
      {(state === 'preparing' || (state === 'downloading' && progress === null)) && <span className="text-center text-[10px]" style={{ color: '#64748B' }}>Case 较多时请保持页面打开</span>}
      {state === 'started' && <span className="text-center text-[10px]" style={{ color: '#64748B' }}>大报告请在浏览器下载栏查看进度</span>}
    </div>
  );
}
