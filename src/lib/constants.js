// Allowed values, spelled exactly as the vault's CLAUDE.md lists them.
export const BUCKETS = [
  { name: 'Client work', c: '--b-client' },
  { name: 'ColibriOS', c: '--b-colibri' },
  { name: 'Gray Bear', c: '--b-graybear' },
  { name: 'DiscoverSWNM', c: '--b-swnm' },
  { name: 'Admin', c: '--b-admin' },
  { name: 'Personal', c: '--b-personal' },
];
export const CLIENTS = ['SENERGY360', 'Vive Management', 'Loma del Mar', 'ColibriOS', 'Dragonfly', 'None'];
export const STATUSES = ['Not started', 'In progress', 'Waiting on someone', 'Done', 'Dropped'];
export const PRIORITIES = ['Today', 'This week', 'Backlog'];
export const SOURCES = ['Meeting', 'Email', 'Brief', 'Stephanie', 'Athena'];
export const EOS_FLAGS = ['Off track Rock', 'Off pace measurable', 'Rolled twice', 'L10 to-do'];
export const CLOSED = new Set(['Done', 'Dropped']);
