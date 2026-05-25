export const BASE_PATH = import.meta.env.VITE_VAULT_QA_PATH ?? ''

export const PROJECTS_PATH = import.meta.env.VITE_VAULT_PROJECTS_PATH ?? ''

export const VAULT_PATH = import.meta.env.VITE_VAULT_ROOT ?? ''

export const toFilePath = (id: string): string => `${BASE_PATH}/${id}.md`
