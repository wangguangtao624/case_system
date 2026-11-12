export const TEST_TYPES = ['firmware', 'chip', 'tool'] as const;
export type TestType = typeof TEST_TYPES[number];
export const TEST_TYPE_LABELS: Record<TestType, string> = {
  firmware: '固件测试', chip: '芯片功能测试', tool: '工具测试',
};
export interface ProjectClassification {
  test_type: TestType;
  chip_model: string;
  firmware_version: string;
}
export function normalizeChip(value: string): string {
  return value.trim().replace(/\s+/g, '').toUpperCase();
}
// Suggestions only: persisted project metadata remains the source of truth.
export function suggestClassification(name: string): ProjectClassification {
  const chip = name.match(/\b(?:MAT|MT)\d+[A-UW-Z]?(?:\s*V\d+(?![\d.]))?/i)?.[0] || '';
  const version = name.match(/(?:v)?\d+\.\d+\.\d+(?:[_-][A-Za-z0-9]+)*/i)?.[0] || '';
  const chipOnly = !!chip && normalizeChip(name) === normalizeChip(chip);
  return { test_type: chipOnly ? 'chip' : 'firmware', chip_model: normalizeChip(chip), firmware_version: version };
}
export function validateClassification(body: Record<string, unknown>, current?: ProjectClassification): ProjectClassification {
  const test_type = body.test_type ?? current?.test_type ?? 'firmware';
  if (!TEST_TYPES.includes(test_type as TestType)) throw new Error('请选择有效的测试类型');
  for (const key of ['chip_model', 'firmware_version'] as const) {
    if (body[key] !== undefined && typeof body[key] !== 'string') throw new Error('芯片型号和版本必须为文本');
  }
  const chip_model = normalizeChip((body.chip_model ?? current?.chip_model ?? '') as string);
  const firmware_version = ((body.firmware_version ?? current?.firmware_version ?? '') as string).trim();
  if (chip_model.length > 80 || firmware_version.length > 120) throw new Error('芯片型号或版本过长');
  if ((test_type === 'firmware' || test_type === 'chip') && !chip_model) throw new Error('请填写所属芯片型号');
  if (test_type === 'firmware' && !firmware_version) throw new Error('请填写固件版本');
  if (test_type === 'chip' && firmware_version) throw new Error('芯片功能测试不需要固件版本');
  return { test_type: test_type as TestType, chip_model, firmware_version: test_type === 'firmware' ? firmware_version : '' };
}
export interface ClassifiedProject {
  testType?: TestType;
  chipModel?: string;
}
export function groupProjects<T extends ClassifiedProject>(projects: T[]) {
  const groups = new Map<string, { key: string; type: TestType; chip: string; projects: T[] }>();
  for (const project of projects) {
    const type = project.testType || 'firmware';
    const chip = type === 'tool' ? '' : normalizeChip(project.chipModel || '') || '待分类芯片';
    const key = `${type}:${chip}`;
    if (!groups.has(key)) groups.set(key, { key, type, chip, projects: [] });
    groups.get(key)!.projects.push(project);
  }
  return [...groups.values()].sort((a, b) => TEST_TYPES.indexOf(a.type) - TEST_TYPES.indexOf(b.type) || a.chip.localeCompare(b.chip));
}
