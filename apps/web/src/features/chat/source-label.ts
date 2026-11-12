import type { SourceDto } from '@docchat/shared';

/** The last heading in a path is the most specific: "Handbook > Leave > Sick Leave" -> "Sick Leave". */
export function sectionName(heading: string | null): string | null {
  return heading?.split(' > ').at(-1) ?? null;
}

export function pagesLabel(source: Pick<SourceDto, 'pageStart' | 'pageEnd'>): string | null {
  const { pageStart, pageEnd } = source;
  if (!pageStart) return null;
  return pageEnd && pageEnd !== pageStart ? `pp. ${pageStart}–${pageEnd}` : `p. ${pageStart}`;
}

/** e.g. "employee-handbook.md · Sick Leave" or "incident-runbook.pdf · pp. 1–2". */
export function sourceLabel(source: SourceDto): string {
  return [source.filename, sectionName(source.heading), pagesLabel(source)]
    .filter(Boolean)
    .join(' · ');
}
