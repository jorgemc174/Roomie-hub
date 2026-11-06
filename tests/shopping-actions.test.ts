import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { organizationMessages } from '../src/features/organization/messages';
import * as logic from '../src/features/organization/logic';
import type { ActionState } from '../src/app/actions';

const home = '11111111-1111-4111-8111-111111111111';
const list = '22222222-2222-4222-8222-222222222222';
async function actions(
  locale: 'es' | 'en',
  error: { message: string; code?: string } | null = null,
) {
  const calls: unknown[] = [];
  const redirects: string[] = [];
  const exports = {} as {
    organizationAction: (
      home: string,
      op: string,
      state: ActionState,
      form: FormData,
    ) => Promise<ActionState>;
  };
  const dependencies: Record<string, unknown> = {
    'next/cache': { revalidatePath: () => {} },
    'next/navigation': {
      redirect: (url: string) => {
        redirects.push(url);
        throw new Error('NEXT_REDIRECT');
      },
      unstable_rethrow: (e: Error) => {
        if (e.message === 'NEXT_REDIRECT') throw e;
      },
    },
    '@/lib/data': {
      requireUser: async () => ({
        db: {
          rpc: async (...args: unknown[]) => {
            calls.push(args);
            return { data: list, error };
          },
        },
      }),
    },
    '@/lib/i18n/server': { i18n: async () => ({ locale }) },
    './messages': { organizationMessages },
    './logic': logic,
  };
  const source = await readFile('src/features/organization/actions.ts', 'utf8');
  vm.runInNewContext(
    ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    {
      exports,
      require: (name: string) => {
        assert.ok(name in dependencies, name);
        return dependencies[name];
      },
    },
  );
  return {
    run: (op: string, form: FormData) => exports.organizationAction(home, op, {}, form),
    calls,
    redirects,
  };
}

test('shopping names have their own validation and never call SQL for empty or whitespace input', async () => {
  for (const locale of ['es', 'en'] as const) {
    const action = await actions(locale);
    for (const op of ['create_list', 'rename_list', 'add_item']) {
      for (const name of ['', '   ', '\t\n', 'x'.repeat(101)]) {
        const form = new FormData();
        form.set('name', name);
        form.set('list_id', list);
        const result = await action.run(op, form);
        assert.equal(
          result.error,
          op === 'add_item'
            ? organizationMessages(locale).productNameInvalid
            : organizationMessages(locale).listNameInvalid,
        );
        assert.notEqual(result.error, organizationMessages(locale).invalid);
      }
    }
    assert.equal(action.calls.length, 0);
  }
});

test('creation navigates to the new list, reopening is explicit, and SQL lock errors are localized', async () => {
  for (const locale of ['es', 'en'] as const) {
    const action = await actions(locale);
    const form = new FormData();
    form.set('name', ' Groceries ');
    form.set('list_id', list);
    await assert.rejects(action.run('create_list', form), /NEXT_REDIRECT/);
    assert.equal(
      action.redirects[0],
      `/homes/${home}/organization?tab=shopping&created=${list}#shopping-${list}`,
    );
    assert.ok((await action.run('reopen_list', form)).success);
    const locked = await actions(locale, { message: 'list_completed' });
    assert.equal(
      (await locked.run('add_item', form)).error,
      organizationMessages(locale).listLocked,
    );
    const invalid = await actions(locale, { message: 'invalid_name' });
    assert.equal(
      (await invalid.run('create_list', form)).error,
      organizationMessages(locale).listNameInvalid,
    );
    assert.equal(
      (await invalid.run('add_item', form)).error,
      organizationMessages(locale).productNameInvalid,
    );
  }
});
