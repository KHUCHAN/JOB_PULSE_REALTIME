import { describe, expect, it, vi } from "vitest";
import { retryIdempotentD1 } from "./d1-idempotent-retry";

const reset = new Error("D1_ERROR: D1 DB storage operation exceeded timeout which caused object to be reset.");

describe("retryIdempotentD1", () => {
  it("replays a transient storage reset with bounded backoff", async () => {
    const operation = vi.fn().mockRejectedValueOnce(reset).mockRejectedValueOnce(reset).mockResolvedValue({ success: true });
    const wait = vi.fn(async () => {});
    await expect(retryIdempotentD1(operation, wait)).resolves.toEqual({ success: true });
    expect(operation).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[250], [500]]);
  });

  it("surfaces a persistent failure without reporting success", async () => {
    const operation = vi.fn().mockRejectedValue(reset);
    await expect(retryIdempotentD1(operation, async () => {})).rejects.toBe(reset);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it.each([
    "D1_ERROR: UNIQUE constraint failed: jobs.id",
    "D1_ERROR: no such column: broken",
    "Your account has exceeded D1's maximum account storage limit",
    "HTTP timeout",
  ])("does not retry a non-transient error: %s", async message => {
    const operation = vi.fn().mockRejectedValue(new Error(message));
    const wait = vi.fn(async () => {});
    await expect(retryIdempotentD1(operation, wait)).rejects.toThrow(message);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });
});
