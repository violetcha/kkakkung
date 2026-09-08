import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export function canonicalPath(value) {
  const path = value.replaceAll('\\', '/');
  if (
    !path ||
    path.startsWith('/') ||
    path.includes(':') ||
    path.split('/').some((p) => p === '..' || p === '.')
  )
    throw new Error('Expected a repository-relative path: ' + value);
  if (/[*?{}[\]]/.test(path)) throw new Error('Declare concrete files, not globs: ' + value);
  return path;
}

export function resolveOwner(path, registry) {
  path = canonicalPath(path);
  const matches = Object.entries(registry.roles)
    .flatMap(([owner, role]) =>
      role.paths
        .filter((rule) => (rule.endsWith('/') ? path.startsWith(rule) : path === rule))
        .map((rule) => ({ owner, rule })),
    )
    .sort((a, b) => b.rule.length - a.rule.length);
  if (
    matches.length > 1 &&
    matches[0].rule.length === matches[1].rule.length &&
    matches[0].owner !== matches[1].owner
  )
    throw new Error('Ambiguous ownership: ' + path);
  return matches[0]?.owner ?? null;
}

export async function readExecutionPlan(root) {
  const registry = JSON.parse(
    await readFile(resolve(root, 'docs/execution/ownership.json'), 'utf8'),
  );
  const tasks = [];
  for (const [role, config] of Object.entries(registry.roles)) {
    const text = (
      await readFile(resolve(root, 'docs/execution', config.document), 'utf8')
    ).replaceAll('\r\n', '\n');
    for (const [, fixed, body] of text.matchAll(
      /^### ([A-F]-\d{2})\n([\s\S]*?)(?=^### [A-F]-\d{2}\n|$(?![\s\S]))/gm,
    )) {
      const [, id, title] = body.match(/^\*\*([A-Z]{2}-\d{2}) · (.*?)\*\*/m) ?? [];
      const paths = [];
      for (const [, block] of body.matchAll(
        /\*\*(?:수정·생성 파일|추가·보완할 시험 파일)\*\*([\s\S]*?)(?=\*\*)/g,
      ))
        for (const [, path] of block.matchAll(/`([^`]+)`/g)) paths.push(canonicalPath(path));
      const depLine = body.match(/^선행 완료 결과: (.*)$/m)?.[1] ?? '';
      const integrationLine = body.match(/^통합 인수 선행: (.*)$/m)?.[1] ?? '';
      const linkedTasks = (line) => [
        ...new Set(
          [...line.matchAll(/\]\([^#)]*#([a-f]-\d{2})\)/g)].map((match) => match[1].toUpperCase()),
        ),
      ];
      tasks.push({
        role,
        fixed,
        id,
        title,
        document: config.document,
        day: body.match(/(?:일정|기존 일정 식별): (D[123])/m)?.[1],
        today: Number(body.match(/오늘 (\d+)번/)?.[1]),
        pending: body.includes('실행 상태: **PRODUCT_DECISION_PENDING**'),
        dependencies: linkedTasks(depLine),
        integrationDependencies: linkedTasks(integrationLine),
        paths: [...new Set(paths)],
        chapters: (body.match(/기획 근거: v0\.0\.8 \*\*(.*?)장\*\*/)?.[1] ?? '')
          .split(/,\s*/)
          .filter(Boolean),
      });
    }
  }
  return { registry, tasks };
}

export function checkDeclaredOwnership(plan) {
  const errors = [];
  const claims = new Map();
  for (const [role, config] of Object.entries(plan.registry.roles))
    for (const path of config.paths) {
      canonicalPath(path);
      if (claims.has(path)) errors.push('Duplicate ownership rule: ' + path);
      claims.set(path, role);
    }
  for (const task of plan.tasks)
    for (const path of task.paths) {
      const owner = resolveOwner(path, plan.registry);
      if (owner !== task.role)
        errors.push(`${task.fixed}: ${path} belongs to ${owner ?? 'UNASSIGNED'}, not ${task.role}`);
    }
  return errors;
}
