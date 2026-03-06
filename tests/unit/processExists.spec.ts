import { isProcessRunning } from '../../src/utils/processExists.js';

/**
 * Unit tests for the isProcessRunning() utility (CDMCH-183).
 *
 * Covers:
 * - Detecting the current (known-running) process
 * - Detecting a dead PID
 * - Windows platform fallback ('unknown')
 * - Re-throwing unexpected errors from process.kill
 */
describe('isProcessRunning', () => {
  it('should return "running" for the current process', () => {
    expect(isProcessRunning(process.pid)).toBe('running');
  });

  it('should return "stopped" for a non-existent PID', () => {
    // PID 2^22 is extremely unlikely to be in use
    const unlikelyPid = 4_194_304;
    expect(isProcessRunning(unlikelyPid)).toBe('stopped');
  });

  it('should return "unknown" on win32', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', writable: true });

    try {
      expect(isProcessRunning(process.pid)).toBe('unknown');
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
    }
  });

  it('should return "running" when process.kill throws EPERM', () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      const err = new Error('Operation not permitted') as NodeJS.ErrnoException;
      err.code = 'EPERM';
      throw err;
    });

    try {
      expect(isProcessRunning(1)).toBe('running');
    } finally {
      killSpy.mockRestore();
    }
  });

  it('should re-throw unexpected errors from process.kill', () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      const err = new Error('Unexpected kernel error') as NodeJS.ErrnoException;
      err.code = 'EINVAL';
      throw err;
    });

    try {
      expect(() => isProcessRunning(1)).toThrow(/check if process 1 exists/);
    } finally {
      killSpy.mockRestore();
    }
  });

  it('should return the ProcessStatus type', () => {
    const result = isProcessRunning(process.pid);
    expect(['running', 'stopped', 'unknown']).toContain(result);
  });
});
