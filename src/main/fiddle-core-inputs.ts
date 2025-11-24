import EventEmitter from 'node:events';

export const eventEmitter = new EventEmitter();
const quickStartTemplates: { [branch: string]: string } = {};
export const TEMPLATE_NOT_YET_LOADED = 'TEMPLATE_NOT_YET_LOADED';
let currentTemplate = TEMPLATE_NOT_YET_LOADED;

eventEmitter.addListener('add-template', (branch: string, folder: string) => {
  quickStartTemplates[branch] = folder;
});
eventEmitter.addListener('set-current-template', (branch: string) => {
  currentTemplate = branch;
});

export function getCurrentTemplateDir() {
  return quickStartTemplates[currentTemplate];
}
