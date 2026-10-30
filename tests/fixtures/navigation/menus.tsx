// Real production controls with local callbacks; never a substitute for private data.
import { useRef, useState } from 'react';
import { RouterContext } from './router';
import { ExpensesNav } from '../../../src/features/expenses/nav';
import { OrganizationNav } from '../../../src/features/organization/nav';
import { TaskNavigation } from '../../../src/features/organization/task-navigation';
import { CommunityNav } from '../../../src/features/community/nav';
import { MessageActions } from '../../../src/features/chat/message-actions';
import { SectionDisclosure } from '../../../src/components/section-disclosure';
import { CreatePanel } from '../../../src/components/ui/create-panel';

export function MenusFixture() {
  const search = new URLSearchParams(location.search),
    path = location.pathname;
  const [action, setAction] = useState('none'),
    [submitted, setSubmitted] = useState(0);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const form = (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted((count) => count + 1);
      }}
    >
      <label>
        Campo de prueba
        <input name="draft" required />
      </label>
      <button type="submit">Enviar prueba</button>
    </form>
  );
  const view = search.get('view') || 'mine';
  return (
    <RouterContext.Provider
      value={{ path: path + location.search, push: (href) => location.assign(href) }}
    >
      <main
        id="main"
        className={`page narrow stack${path.endsWith('/organization') || path.endsWith('/community') ? ' organization' : ''}${path.endsWith('/chat') ? ' chat-shell' : ''}`}
      >
        <p>Prueba aislada de componentes de navegación. Sin datos privados.</p>
        {path.endsWith('/organization') && (
          <>
            <h1>{view === 'manage' ? 'Configurar tareas' : 'Tareas'}</h1>
            <OrganizationNav homeId="menus" locale="es" tab="tasks" />
            <TaskNavigation
              homeId="menus"
              locale="es"
              view={view}
              from={search.get('from') || '2026-10-01'}
              returnView={search.get('returnView') || undefined}
            >
              <CreatePanel title="Crear tarea" closeLabel="Cerrar formulario">
                {form}
              </CreatePanel>
            </TaskNavigation>
            {view === 'manage' && (
              <SectionDisclosure title="Generar y revisar asignaciones">{form}</SectionDisclosure>
            )}
          </>
        )}
        {path.endsWith('/expenses') && (
          <>
            <h1>Gastos</h1>
            <ExpensesNav homeId="menus" locale="es" tab={search.get('tab') || 'expenses'} />
            {search.get('tab') === 'balances' && (
              <>
                <CreatePanel
                  title="Registrar pago"
                  closeLabel="Cerrar formulario"
                  defaultOpen={search.get('create') === 'payment'}
                >
                  {form}
                </CreatePanel>
                <SectionDisclosure title="Pagos registrados" kind="history">
                  <p>Contenedor de historial sin datos.</p>
                </SectionDisclosure>
              </>
            )}
          </>
        )}
        {path.endsWith('/community') && (
          <>
            <h1>Convivencia</h1>
            <CommunityNav homeId="menus" locale="es" tab={search.get('tab') || 'points'} />
            <SectionDisclosure
              title="Filtros de la vista"
              kind="filters"
              defaultOpen={search.has('person')}
            >
              {form}
            </SectionDisclosure>
          </>
        )}
        {path.endsWith('/chat') && (
          <>
            <h1>Chat · opciones de mensaje</h1>
            <article className="panel chat-message">
              <MessageActions
                locale="es"
                own={!search.has('foreign')}
                pending={search.has('pending')}
                reactions={[{ message_id: 'test', emoji: '👍', mine: true, count: 1 }]}
                onReply={() => {
                  setAction('reply');
                  textarea.current?.focus();
                }}
                onEdit={() => {
                  setAction('edit');
                  textarea.current?.focus();
                }}
                onRemove={() => setAction('confirmation')}
                onReaction={(emoji, enabled) => setAction(`${emoji}:${enabled}`)}
              />
            </article>
            <label>
              Compositor de prueba
              <textarea ref={textarea} />
            </label>
          </>
        )}
        <output data-testid="menu-action">{action}</output>
        <output data-testid="menu-submitted">{submitted}</output>
      </main>
    </RouterContext.Provider>
  );
}
