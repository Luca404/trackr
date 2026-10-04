export function errorInfo(value: unknown): {
  message: string; name?: string; code?: string;
  response?: { status?: number; data?: { message?: string; detail?: string } };
} {
  if (!value || typeof value !== 'object') return { message: String(value ?? '') };
  const error = value as { message?: unknown; name?: unknown; code?: unknown; response?: unknown };
  const response = error.response && typeof error.response === 'object'
    ? error.response as { status?: number; data?: { message?: string; detail?: string } } : undefined;
  return {
    message: typeof error.message === 'string' ? error.message : '',
    name: typeof error.name === 'string' ? error.name : undefined,
    code: typeof error.code === 'string' ? error.code : undefined,
    response,
  };
}
