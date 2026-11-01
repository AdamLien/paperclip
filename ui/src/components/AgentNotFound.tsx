import { Bot } from "lucide-react";
import { ApiError } from "../api/client";
import { EmptyState } from "./EmptyState";

export function isNotFoundError(error: unknown) {
  return error instanceof ApiError && error.status === 404;
}

/** A missing or unshared partner will not appear on retry, so show the answer at once. */
export function retryUnlessNotFound(failureCount: number, error: unknown) {
  return !isNotFoundError(error) && failureCount < 3;
}

export function AgentNotFound() {
  return (
    <EmptyState
      icon={Bot}
      title="This AI partner is not available"
      message="It may have been removed, or it has not been shared with you."
    />
  );
}
