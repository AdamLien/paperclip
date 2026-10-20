/** Keep the final delivery visible; retain the complete transcript on demand. */
export function completedThreadHistoryStart(messages: readonly { role: string }[]): number {
  if (messages.length <= 16) return 0;
  const lastRequest = messages.findLastIndex((message) => message.role === "user");
  return lastRequest >= 0 && lastRequest < messages.length - 1
    ? lastRequest + 1
    : Math.max(0, messages.length - 8);
}
