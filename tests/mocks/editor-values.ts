import {
  EditorValues,
  MAIN_JS,
  ROOT_UI_COMPONENT_JS,
} from '../../src/interfaces';

export function createEditorValues(): EditorValues {
  return {
    [MAIN_JS]: '// index.js',
    [ROOT_UI_COMPONENT_JS]: '// App.js',
    'metro.config.js': '// metro.config.js',
    'reporter.js': '// reporter.js',
  };
}
