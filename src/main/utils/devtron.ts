export function normaliseMaybeDevtronValue(value: unknown) {
  return typeof value === 'object' &&
    value !== null &&
    '__uuid__devtron' in value &&
    typeof value.__uuid__devtron === 'string' &&
    'args' in value &&
    Array.isArray(value.args)
    ? value.args[0]
    : value;
}
