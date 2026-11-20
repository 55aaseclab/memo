export function createBusinessHooks({ MEMO_RECORD_OPERATIONS }) {
  return { responseLimit: request => MEMO_RECORD_OPERATIONS.includes(request.operation) ? 10 * 1024 * 1024 : 4 * 1024 * 1024 };
}
