import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import { createElement, type ReactNode } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { organizationMessages } from '../src/features/organization/messages';
import * as logic from '../src/features/organization/logic';
import { es, en } from '../src/lib/i18n/dictionaries';

async function shoppingControls(react = React) {
  const exports: Record<string, (props: Record<string, unknown>) => ReactNode> = {};
  vm.runInNewContext(
    ts.transpileModule(await readFile('src/features/organization/shopping-controls.tsx', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText,
    {
      exports,
      require: (name: string) => {
        if (name === 'react') return react;
        if (name === 'react/jsx-runtime') return jsxRuntime;
        if (name === '@/components/action-form')
          return {
            ActionForm: ({ children, label }: { children: ReactNode; label: string }) =>
              createElement(
                'form',
                null,
                children,
                createElement('button', { type: 'submit' }, label),
              ),
          };
        throw new Error(name);
      },
    },
  );
  return exports;
}

// Render the actual server page with read dependencies isolated from remote accounts.
// Action dispatch and client interactions have separate tests.
async function shoppingPage(locale: 'es' | 'en', completed: boolean) {
  const container = ({ children }: { children?: ReactNode }) =>
    createElement('div', null, children);
  const dependencies: Record<string, unknown> = {
    '@/components/ui/create-panel': { CreatePanel: container },
    '@/components/ui/empty-state': { EmptyState: () => null },
    './nav': { OrganizationNav: () => null, OrganizationOptions: () => null },
    '@/components/ui/options-menu': { OptionsMenu: container },
    '@/components/ui/page-header': { PageHeader: () => null },
    './task-list': { TaskList: () => null },
    './task-navigation': { TaskNavigation: () => null },
    '@/components/section-disclosure': { SectionDisclosure: container },
    '@/features/expenses/messages': { expenseMessages: () => ({ shopping: 'expense' }) },
    'next/link': {
      __esModule: true,
      default: ({ children, href }: { children: ReactNode; href: string }) =>
        createElement('a', { href }, children),
    },
    '@/lib/data': {
      getHome: async () => ({ timezone: 'UTC' }),
      getMembers: async () => [],
      requireUser: async () => ({ db: { rpc: async () => ({ error: null }) }, user: { id: 'me' } }),
    },
    '@/lib/i18n/server': { i18n: async () => ({ locale, t: locale === 'es' ? es : en }) },
    '@/components/action-form': {
      ActionForm: ({ children, label }: { children?: ReactNode; label: string }) =>
        createElement('form', null, children, createElement('button', { type: 'submit' }, label)),
    },
    './messages': { organizationMessages },
    './actions': { organizationAction: async () => ({}) },
    './logic': logic,
    './chore-form': { ChoreForm: () => null },
    './queries': {
      readOrganizationRows: async () =>
        Object.fromEntries(
          ['chores', 'rotations', 'instances', 'absences', 'lists', 'items', 'events'].map(
            (key) => [
              key,
              {
                error: null,
                data:
                  key === 'lists'
                    ? [
                        {
                          id: 'new-list',
                          name: 'Groceries',
                          completed_at: completed ? '2026-11-03T12:00:00Z' : null,
                        },
                      ]
                    : key === 'items'
                      ? [
                          {
                            id: 'milk',
                            name: 'Milk',
                            shopping_list_id: 'new-list',
                            purchased: completed,
                          },
                        ]
                      : [],
              },
            ],
          ),
        ),
    },
    '@/lib/timezones': { homeDate: () => '2026-11-03' },
    './generation': { ensureOrganizationPeriod: async () => ({ error: null }) },
    './shopping-controls': {
      ...(await shoppingControls()),
      ShoppingAnchor: () => null,
      DeleteShoppingList: () => createElement('div', null, 'delete-confirmation'),
    },
  };
  const exports = {} as {
    OrganizationPage: (props: {
      homeId: string;
      search: Record<string, string>;
    }) => Promise<ReactNode>;
  };
  vm.runInNewContext(
    ts.transpileModule(await readFile('src/features/organization/page.tsx', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText,
    {
      exports,
      URLSearchParams,
      require: (name: string) => {
        if (name === 'react/jsx-runtime') return jsxRuntime;
        assert.ok(name in dependencies, name);
        return dependencies[name];
      },
    },
  );
  return renderToStaticMarkup(
    await exports.OrganizationPage({
      homeId: 'home',
      search: { tab: 'shopping', created: 'new-list' },
    }),
  );
}

test('completed shopping list shows its lock and explicit reopen, preserving products and expense link', async () => {
  for (const locale of ['es', 'en'] as const) {
    const t = organizationMessages(locale);
    const html = await shoppingPage(locale, true);
    const section = html.slice(html.indexOf('<section'));
    assert.ok(section.includes(t.listLocked));
    assert.ok(section.includes(t.reopenList));
    assert.ok(section.includes('Milk'));
    assert.ok(section.includes('/homes/home/expenses?shopping=new-list'));
    assert.ok(section.includes('delete-confirmation'));
    for (const label of [t.newItem, t.rename, t.unpurchase, t.buy, t.completeList])
      assert.ok(!section.includes(label), label);
  }
});

test('open shopping list retains editing and stable focus target; creation requires a name', async () => {
  for (const locale of ['es', 'en'] as const) {
    const t = organizationMessages(locale);
    const html = await shoppingPage(locale, false);
    assert.ok(html.includes('id="shopping-new-list" tabindex="-1"'));
    assert.ok(html.includes(t.newItem));
    assert.ok(html.includes(t.rename));
    assert.ok(html.includes(t.buy));
    assert.ok(!html.includes(t.reopenList));
    const createForm = html.slice(html.indexOf('<form'), html.indexOf('</form>'));
    assert.ok(createForm.includes('required'));
    assert.ok(createForm.includes('aria-invalid="false"'));
  }
});

// Exercise the capture handler before ActionForm can dispatch its server action.
for (const locale of ['es', 'en'] as const) {
  for (const rename of [false, true]) {
    for (const name of ['', '   ', 'Compra semanal']) {
      test(`${locale}: ${rename ? 'rename' : 'create'} ${JSON.stringify(name)} handles submission locally`, async () => {
        const input = {
          value: name,
          focus: () => {
            focused = true;
          },
        };
        let focused = false,
          closedFocus = false,
          invalid = false,
          prevented = false,
          stopped = false;
        let calls = 0,
          refs = 0;
        const details = {
          open: true,
          querySelector: () => ({
            focus: () => {
              closedFocus = true;
            },
          }),
        };
        const react = {
          ...React,
          useRef: () => ({ current: refs++ === 0 ? input : details }),
          useState: () => [
            false,
            (value: boolean) => {
              invalid = value;
            },
          ],
          useId: () => 'name-error',
        } as unknown as typeof React;
        const { ShoppingListNameForm } = await shoppingControls(react);
        const action = async () => {
          calls++;
          return {};
        };
        const tree = ShoppingListNameForm({
          action,
          t: organizationMessages(locale),
          list: rename ? { id: 'list', name: 'Supermercado' } : undefined,
        }) as React.ReactElement<{
          children: React.ReactElement[];
          onSubmitCapture: (event: unknown) => void;
        }>;
        const wrapper = rename ? (tree.props.children[1] as typeof tree) : tree;
        wrapper.props.onSubmitCapture({
          preventDefault: () => {
            prevented = true;
          },
          stopPropagation: () => {
            stopped = true;
          },
        });
        if (!prevented) await action();
        const empty = !name.trim();
        assert.equal(calls, empty ? 0 : 1);
        assert.equal(prevented, empty);
        assert.equal(stopped, empty);
        assert.equal(invalid, empty && !rename);
        assert.equal(focused, empty && !rename);
        assert.equal(details.open, !(empty && rename));
        assert.equal(closedFocus, empty && rename);
        assert.equal(input.value, empty && rename ? 'Supermercado' : name);
      });
    }
  }
}
