/**
 * Unit tests for commandRunner module
 *
 * Comprehensive coverage for parseCommandString, which implements a
 * character-by-character shell-style argument parser. Tests cover:
 * - Basic splitting
 * - Single-quoted strings (no escape interpretation)
 * - Double-quoted strings (escape interpretation)
 * - Backslash escape sequences
 * - Mixed quote types
 * - Edge cases and error conditions
 */

import { describe, it, expect } from 'vitest';
import { parseCommandString } from '../../src/workflows/commandRunner.js';

describe('parseCommandString', () => {
  // ── Basic command splitting ──────────────────────────────────────────────

  it('returns a single executable with no args', () => {
    const [exe, args] = parseCommandString('ls');
    expect(exe).toBe('ls');
    expect(args).toEqual([]);
  });

  it('splits a simple command with arguments', () => {
    const [exe, args] = parseCommandString('git commit -m message');
    expect(exe).toBe('git');
    expect(args).toEqual(['commit', '-m', 'message']);
  });

  it('handles multiple spaces between tokens', () => {
    const [exe, args] = parseCommandString('npm  run  build');
    expect(exe).toBe('npm');
    expect(args).toEqual(['run', 'build']);
  });

  it('handles leading and trailing spaces', () => {
    const [exe, args] = parseCommandString('  echo hello  ');
    expect(exe).toBe('echo');
    expect(args).toEqual(['hello']);
  });

  // ── Double-quoted strings ────────────────────────────────────────────────

  it('treats double-quoted string as a single argument', () => {
    const [exe, args] = parseCommandString('echo "hello world"');
    expect(exe).toBe('echo');
    expect(args).toEqual(['hello world']);
  });

  it('handles multiple double-quoted arguments', () => {
    const [exe, args] = parseCommandString('git commit -m "fix: resolve bug" --author "Jane Doe"');
    expect(exe).toBe('git');
    expect(args).toEqual(['commit', '-m', 'fix: resolve bug', '--author', 'Jane Doe']);
  });

  it('drops empty double-quoted string (implementation limitation)', () => {
    // Note: empty quotes '' or "" are not preserved as empty-string args.
    // The implementation silently drops them, unlike POSIX sh.
    const [exe, args] = parseCommandString('echo ""');
    expect(exe).toBe('echo');
    expect(args).toEqual([]);
  });

  it('concatenates adjacent tokens and quoted strings', () => {
    const [exe, args] = parseCommandString('echo pre"mid"suf');
    expect(exe).toBe('echo');
    expect(args).toEqual(['premidsuf']);
  });

  // ── Single-quoted strings ────────────────────────────────────────────────

  it('treats single-quoted string as a single argument', () => {
    const [exe, args] = parseCommandString("echo 'hello world'");
    expect(exe).toBe('echo');
    expect(args).toEqual(['hello world']);
  });

  it('drops empty single-quoted string (implementation limitation)', () => {
    // Note: empty quotes '' or "" are not preserved as empty-string args.
    // The implementation silently drops them, unlike POSIX sh.
    const [exe, args] = parseCommandString("echo ''");
    expect(exe).toBe('echo');
    expect(args).toEqual([]);
  });

  // ── Backslash escape sequences ───────────────────────────────────────────

  it('handles backslash escape inside double quotes', () => {
    const [exe, args] = parseCommandString('echo "it\\"s"');
    expect(exe).toBe('echo');
    expect(args).toEqual(['it"s']);
  });

  it('handles backslash escape inside single quotes', () => {
    const [exe, args] = parseCommandString("echo 'it\\'s'");
    expect(exe).toBe('echo');
    expect(args).toEqual(["it's"]);
  });

  // ── Mixed quote types ────────────────────────────────────────────────────

  it('single quote inside double-quoted string is literal', () => {
    const [exe, args] = parseCommandString(`echo "it's fine"`);
    expect(exe).toBe('echo');
    expect(args).toEqual(["it's fine"]);
  });

  it('double quote inside single-quoted string is literal', () => {
    const [exe, args] = parseCommandString(`echo 'say "hello"'`);
    expect(exe).toBe('echo');
    expect(args).toEqual(['say "hello"']);
  });

  // ── Shell metacharacter passthrough ──────────────────────────────────────

  it('passes through shell metacharacters without interpretation', () => {
    const [exe, args] = parseCommandString('echo $HOME');
    expect(exe).toBe('echo');
    expect(args).toEqual(['$HOME']);
  });

  it('treats pipe character as a literal argument token', () => {
    const [exe, args] = parseCommandString('echo foo|bar');
    expect(exe).toBe('echo');
    expect(args).toEqual(['foo|bar']);
  });

  // ── Path arguments ───────────────────────────────────────────────────────

  it('handles absolute path as executable', () => {
    const [exe, args] = parseCommandString('/usr/bin/node --version');
    expect(exe).toBe('/usr/bin/node');
    expect(args).toEqual(['--version']);
  });

  it('handles flags with equals sign', () => {
    const [exe, args] = parseCommandString('npm install --save-dev=true');
    expect(exe).toBe('npm');
    expect(args).toEqual(['install', '--save-dev=true']);
  });

  // ── Error conditions ─────────────────────────────────────────────────────

  it('throws on empty string', () => {
    expect(() => parseCommandString('')).toThrow('Empty command string');
  });

  it('throws on whitespace-only string', () => {
    expect(() => parseCommandString('   ')).toThrow('Empty command string');
  });

  // ── Real-world validation command examples ───────────────────────────────

  it('parses npm test command', () => {
    const [exe, args] = parseCommandString('npm test -- --reporter=verbose');
    expect(exe).toBe('npm');
    expect(args).toEqual(['test', '--', '--reporter=verbose']);
  });

  it('parses eslint with quoted glob pattern', () => {
    const [exe, args] = parseCommandString('npx eslint "src/**/*.ts" --max-warnings 0');
    expect(exe).toBe('npx');
    expect(args).toEqual(['eslint', 'src/**/*.ts', '--max-warnings', '0']);
  });

  it('parses tsc command', () => {
    const [exe, args] = parseCommandString('npx tsc --noEmit');
    expect(exe).toBe('npx');
    expect(args).toEqual(['tsc', '--noEmit']);
  });
});
