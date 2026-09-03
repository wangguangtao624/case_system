import { NextResponse } from 'next/server';
import { loadReportData, resolveReportPayload } from '@/lib/report-data';
import { buildOfflineReportHtmlParts, estimateOfflineReportBytes } from '@/lib/report-html';
import { fetchJiraIssues } from '@/lib/jira-issues';
import archiver from 'archiver';
import fs from 'fs';
import { Readable } from 'stream';

function safeArchiveSegment(value: string) {
  return value.replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 100) || '未命名';
}

function attachmentPath(caseId: number, caseName: string, fileId: number, fileName: string) {
  return `附件/Case-${caseId}-${safeArchiveSegment(caseName)}/${fileId}-${safeArchiveSegment(fileName)}`;
}

function relativeHref(archivePath: string) {
  return archivePath.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

function isExpectedDownloadCancel(error: unknown) {
  return error instanceof Error && (error.name === 'ResponseAborted' || error.message.includes('ResponseAborted'));
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const payload = await resolveReportPayload(token);
    if (!payload) return NextResponse.json({ error: '报告链接无效' }, { status: 404 });
    const report = loadReportData(payload, undefined, { includeAllCaseDetails: true });
    if (!report) return NextResponse.json({ error: '报告不存在' }, { status: 404 });
    report.jiraIssues = await fetchJiraIssues(report.jiraLinks.map(item => item.link));
    const safeName = report.project.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || '测试报告';
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('warning', warning => console.warn('Offline report archive warning:', warning));
    archive.on('error', error => {
      if (!isExpectedDownloadCancel(error)) console.error('Offline report archive error:', error);
    });

    const parts = buildOfflineReportHtmlParts(report, {
      attachmentHref: (item, file) => {
        if (!fs.existsSync(file.storagePath)) return null;
        return relativeHref(attachmentPath(item.id, item.caseName, file.id, file.originalName));
      },
    });
    archive.append(Readable.from(parts), { name: '测试报告.html' });

    for (const item of report.cases) {
      for (const file of item.files) {
        if (file.source === 'editor' || !fs.existsSync(file.storagePath)) continue;
        archive.file(file.storagePath, {
          name: attachmentPath(item.id, item.caseName, file.id, file.originalName),
        });
      }
    }
    void archive.finalize().catch(error => {
      if (!isExpectedDownloadCancel(error)) console.error('Finalize offline report archive error:', error);
    });

    return new NextResponse(Readable.toWeb(archive) as BodyInit, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${safeName}-${report.scopeLabel}-离线报告.zip`)}`,
        'Cache-Control': 'no-store',
        'X-Report-Estimated-Bytes': String(estimateOfflineReportBytes(report)),
      },
    });
  } catch (error) {
    console.error('Download report error:', error);
    return NextResponse.json({ error: '生成离线报告失败' }, { status: 500 });
  }
}
