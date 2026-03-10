import { describe, expect, it } from 'vitest';

import { getStartExitCode } from '../../../src/cli/commands/start';

describe('getStartExitCode', () => {
  it('returns 30 when PRD approval is required', () => {
    expect(getStartExitCode({ approvalRequired: true })).toBe(30);
  });

  it('returns 1 when execution finished with failed tasks', () => {
    expect(
      getStartExitCode({
        approvalRequired: false,
        execution: {
          failedTasks: 2,
          permanentlyFailedTasks: 0,
        },
      })
    ).toBe(1);
  });

  it('returns 1 when execution finished with permanently failed tasks', () => {
    expect(
      getStartExitCode({
        approvalRequired: false,
        execution: {
          failedTasks: 0,
          permanentlyFailedTasks: 1,
        },
      })
    ).toBe(1);
  });

  it('returns 0 when execution succeeded or was skipped', () => {
    expect(
      getStartExitCode({
        approvalRequired: false,
        execution: {
          failedTasks: 0,
          permanentlyFailedTasks: 0,
        },
      })
    ).toBe(0);

    expect(getStartExitCode({ approvalRequired: false })).toBe(0);
  });
});
