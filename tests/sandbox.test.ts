import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseMemLimit, WORKSPACE } from '../src/sandbox/runner';
import { cleanupHostDir } from '../src/sandbox/clone';

describe('Sandbox Utilities', () => {
  describe('parseMemLimit', () => {
    it('parses megabytes (m / M)', () => {
      expect(parseMemLimit('512m')).toBe(512 * 1024 * 1024);
      expect(parseMemLimit('256M')).toBe(256 * 1024 * 1024);
    });

    it('parses gigabytes (g / G)', () => {
      expect(parseMemLimit('1g')).toBe(1024 * 1024 * 1024);
      expect(parseMemLimit('2G')).toBe(2 * 1024 * 1024 * 1024);
    });

    it('parses kilobytes (k / K)', () => {
      expect(parseMemLimit('128k')).toBe(128 * 1024);
    });

    it('parses raw byte numbers', () => {
      expect(parseMemLimit('1048576')).toBe(1048576);
    });
  });

  describe('cleanupHostDir', () => {
    it('recursively cleans up temporary host directory and files', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repro-test-clean-'));
      const sampleFile = path.join(tempDir, 'sub', 'file.txt');
      fs.mkdirSync(path.dirname(sampleFile), { recursive: true });
      fs.writeFileSync(sampleFile, 'hello');

      expect(fs.existsSync(sampleFile)).toBe(true);

      cleanupHostDir(tempDir);

      expect(fs.existsSync(tempDir)).toBe(false);
    });

    it('does not throw when directory does not exist', () => {
      expect(() => cleanupHostDir(path.join(os.tmpdir(), 'non-existent-repro-dir'))).not.toThrow();
    });
  });

  describe('WORKSPACE constant', () => {
    it('sets WORKSPACE root to /workspace', () => {
      expect(WORKSPACE).toBe('/workspace');
    });
  });
});
