import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readExecutionPlan, checkDeclaredOwnership } from './lib/execution-plan.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--role', '--day', '--tasks'].includes(args[i]) || !args[i + 1] || options[args[i]])
    throw new Error('Usage: node scripts/prepare-execution.mjs --role A --tasks 1-5 [--day D2]');
  options[args[i]] = args[i + 1];
}
const role = options['--role'];
const day = options['--day'];
const range = /^(\d+)-(\d+)$/.exec(options['--tasks'] ?? '');
if (!/^[A-F]$/.test(role ?? '') || !range || (day && !/^D[123]$/.test(day)))
  throw new Error('Specify role A-F, range 1-5, and optional day D1-D3. No implicit current date.');
const start = Number(range[1]);
const end = Number(range[2]);
if (start < 1 || end < start || end > 99) throw new Error('Invalid task range');
const plan = await readExecutionPlan(root);
const errors = checkDeclaredOwnership(plan);
if (errors.length) throw new Error(errors.join('\n'));
const selected = plan.tasks.filter(
  (task) =>
    task.role === role &&
    (!day || task.day === day) &&
    (day ? task.today : Number(task.fixed.slice(2))) >= start &&
    (day ? task.today : Number(task.fixed.slice(2))) <= end,
);
if (selected.length !== end - start + 1)
  throw new Error(
    'The entire range must exist. D3 follow-up rows have no new fixed IDs; read the role D3 table.',
  );
const selectedIds = new Set(selected.map((task) => task.fixed));
const prerequisites = [...new Set(selected.flatMap((task) => task.dependencies))].filter(
  (id) => !selectedIds.has(id),
);
const integrationDependencies = [
  ...new Set(selected.flatMap((task) => task.integrationDependencies)),
];
const integrationOutsideRequestedRange = integrationDependencies.filter(
  (id) => !selectedIds.has(id),
);
const exists = async (path) => {
  try {
    await access(resolve(root, path));
    return true;
  } catch {
    return false;
  }
};
const outputs = [];
for (const task of selected) {
  const paths = [];
  for (const path of task.paths) paths.push({ path, exists: await exists(path), owner: role });
  outputs.push({ ...task, paths });
}
console.log(
  JSON.stringify(
    {
      mode: 'READ_ONLY_PLAN',
      role,
      numbering: day ? day + ' today numbers' : 'fixed role numbers',
      readFirst: [
        'AGENTS.md',
        'CONTRIBUTING.md',
        'requirements.md',
        'docs/architecture.md',
        'docs/spec/decisions.md',
        `docs/execution/${plan.registry.roles[role].document}`,
        'docs/execution/contracts/types.ts',
        'docs/execution/contracts/fixtures.ts',
        'docs/execution/contracts/fixtures.test.ts',
        `docs/execution/handoffs/${role}.md`,
      ],
      specChapters: [...new Set(selected.flatMap((task) => task.chapters))].sort(),
      prerequisiteHandoffs: [
        ...new Set(prerequisites.map((id) => `docs/execution/handoffs/${id[0]}.md`)),
      ],
      outsideRequestedRange: prerequisites,
      integrationDependencies,
      integrationOutsideRequestedRange,
      integrationPrerequisiteHandoffs: [
        ...new Set(
          integrationOutsideRequestedRange.map((id) => `docs/execution/handoffs/${id[0]}.md`),
        ),
      ],
      prerequisiteRule:
        'Check published exports, commits and tests. Contract fixtures permit isolated work; integration requires real producers. Do not implement another role or expand the requested range.',
      tasks: outputs,
      productCompletionInferred: false,
    },
    null,
    2,
  ),
);
