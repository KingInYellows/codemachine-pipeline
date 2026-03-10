/**
 * Unit tests for commandRunner module
 *
 * Coverage for parseCommandString, which delegates to shell-quote for
 * POSIX-compliant argument parsing. Tests cover:
 * - Basic splitting
 * - Single-quoted strings
 * - Double-quoted strings
 * - Mixed quote types
 * - Edge cases, error conditions, and security (operator rejection)
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

  it('preserves empty double-quoted string (POSIX-compliant)', () => {
    const [exe, args] = parseCommandString('echo ""');
    expect(exe).toBe('echo');
    expect(args).toEqual(['']);
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

  it('preserves empty single-quoted string (POSIX-compliant)', () => {
    const [exe, args] = parseCommandString("echo ''");
    expect(exe).toBe('echo');
    expect(args).toEqual(['']);
  });

  // ── Backslash escape sequences ───────────────────────────────────────────

  it('handles backslash escape inside double quotes', () => {
    const [exe, args] = parseCommandString('echo "it\\"s"');
    expect(exe).toBe('echo');
    expect(args).toEqual(['it"s']);
  });

  it('keeps backslashes literal inside single quotes', () => {
    const [exe, args] = parseCommandString("echo 'it\\\\s'");
    expect(exe).toBe('echo');
    expect(args).toEqual(['it\\\\s']);
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

  // ── Shell operator rejection (security) ─────────────────────────────────

  it('preserves env vars as literal strings', () => {
    const [exe, args] = parseCommandString('echo $HOME');
    expect(exe).toBe('echo');
    expect(args).toEqual(['$HOME']);
  });

  it('preserves brace-style env vars as literal strings', () => {
    const [exe, args] = parseCommandString('echo ${HOME}');
    expect(exe).toBe('echo');
    expect(args).toEqual(['${HOME}']);
  });

  it('rejects pipe operator (security)', () => {
    expect(() => parseCommandString('echo foo | cat')).toThrow(
      'Shell operators are not allowed in command strings'
    );
  });

  it('rejects semicolon operator (security)', () => {
    expect(() => parseCommandString('echo safe ; rm -rf /')).toThrow(
      'Shell operators are not allowed in command strings'
    );
  });

  it('rejects && operator (security)', () => {
    expect(() => parseCommandString('npm test && npm run lint')).toThrow(
      'Shell operators are not allowed in command strings'
    );
  });

  it('rejects || operator (security)', () => {
    expect(() => parseCommandString('npm test || exit 1')).toThrow(
      'Shell operators are not allowed in command strings'
    );
  });

  it('preserves comment-like tokens as literals', () => {
    const [exe, args] = parseCommandString('echo foo #bar');
    expect(exe).toBe('echo');
    expect(args).toEqual(['foo', '#bar']);
  });

  // ── Glob patterns (regression test) ──────────────────────────────────────

  it('handles unquoted glob pattern with find command', () => {
    const [exe, args] = parseCommandString('find . -name *.json');
    expect(exe).toBe('find');
    expect(args).toEqual(['.', '-name', '*.json']);
  });

  it('handles unquoted glob pattern with eslint', () => {
    const [exe, args] = parseCommandString('npx eslint src/**/*.ts --max-warnings 0');
    expect(exe).toBe('npx');
    expect(args).toEqual(['eslint', 'src/**/*.ts', '--max-warnings', '0']);
  });

  // ── Path arguments ───────────────────────────────────────────────────────

  it('handles absolute path as executable', () => {

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

  it('parses tsc command', () => {
    const [exe, args] = parseCommandString('npx tsc --noEmit');
    expect(exe).toBe('npx');
    expect(args).toEqual(['tsc', '--noEmit']);
  });
});
