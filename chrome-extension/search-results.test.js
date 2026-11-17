import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./window.js', import.meta.url), 'utf8');
function section(start, end) { return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))); }
class Element {
  children = []; listeners = {}; classList = { add() {} };
  append(...children) { this.children.push(...children); }
  setAttribute() {}
  addEventListener(type, handler) { this.listeners[type] = handler; }
}
test('remote results expose only Calendar or pending Undo and open the shared picker for synthetic events/tasks', () => {
  const fixtures = [
    { id: 'timed', summary: 'Synthetic event', start: { dateTime: '2030-01-01T10:30:00' } },
    { id: 'task:fixture:undated', summary: 'Synthetic task', task: { due: null }, start: { date: '2030-01-01' } },
    { id: 'recurring', summary: 'Synthetic recurring', recurringEventId: 'series', start: { date: '2030-01-01' } }
  ];
  const list = new Element(); let opened = 0, commits = 0, undos = 0;
  const context = vm.createContext({ document: { createElement: () => new Element() }, list,
    searchQueryInput: { value: 'Synthetic' }, remoteSearch: { query: 'Synthetic', events: fixtures },
    realEventsOnly: false, account: 'fixture@example.invalid', calendarZone: 'UTC', renderedItemLimit: 100,
    undo: { current: null, committingActions: new Set(), commit() { commits++; }, undo() { undos++; } },
    prioritizing: new Set(), isEmphasized: () => false, isPriority: () => false, isTwoDaysOld: () => false,
    isRecurring: e => !!e.recurringEventId, calendarEventAction: () => null,
    datePicker: { showPicker() {} }, timePicker: {}, timeToggle: { setAttribute() {} },
    calendarDialog: { showModal() { opened++; } }, actionDescription: () => 'Move pending',
    searchCalendar() {}, openEventLink() {}
  });
  vm.runInContext('let dateTarget;\n' + section('function button(', 'function moveTile(') + section('function calendarButton(', 'function priorityButton(') + section('function renderSearchFooter(', 'function renderEvent(') + '\nrenderSearchFooter();', context);
  const rows = list.children.filter(e => e.className === 'search-result');
  assert.equal(rows.length, 3);
  const actions = rows.map(row => row.children[0].children[1].children);
  assert.deepEqual(actions.map(a => a.map(b => b.textContent)), [['📅'], ['📅'], ['📅']]);
  assert.equal(actions[2][0].disabled, true);
  actions[0][0].listeners.click();
  assert.equal(opened, 1); assert.equal(commits, 1);
  assert.equal(vm.runInContext('dateTarget.id', context), 'timed');
  assert.equal(context.timeToggle.hidden, false);
  actions[1][0].listeners.click();
  assert.equal(context.timeToggle.hidden, true);
  assert.equal(vm.runInContext('dateTarget.id', context), 'task:fixture:undated');
  context.undo.current = { event: fixtures[0] }; list.children = [];
  vm.runInContext('renderSearchFooter()', context);
  const pending = list.children.find(e => e.className === 'search-result');
  const undo = pending.children[0].children[1].children[0];
  assert.equal(undo.textContent, 'Undo'); undo.listeners.click(); assert.equal(undos, 1);
});
