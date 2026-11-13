import type { FLAG_SOURCES } from '@/structure/schema';

// The texts the committee types editor needs, read on the server and handed to the client.
export const EDITOR_LABEL_KEYS = ['addCategory', 'addField', 'addGroup', 'addType', 'aliases', 'aliasesHelp', 'bulk', 'bulkHelp', 'categoriesEmpty', 'categoriesHelp', 'categoriesTitle', 'color', 'columnGroup', 'columnLabel', 'columnName', 'confidential', 'confidentialHelp', 'defaultCategory', 'fields', 'fieldsHelp', 'flag', 'groupLabel', 'groupLabelHelp', 'groupRequired', 'groups', 'key', 'labelField', 'labelFieldHelp', 'logo', 'moveDown', 'moveUp', 'name', 'noCategory', 'remove', 'saveAndPublish', 'saveDraft', 'short', 'typesHelp', 'typesTitle'] as const;
export type EditorLabels = Record<(typeof EDITOR_LABEL_KEYS)[number] | `flag_${(typeof FLAG_SOURCES)[number]}`, string>;
