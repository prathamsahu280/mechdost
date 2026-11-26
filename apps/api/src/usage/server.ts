/**
 * The server's own disk and memory (founder 2026-11-26). Disk: `statfs` of `USAGE_DISK_PATH` (default `/`; inside the
 * container that is the Docker root filesystem, which lives on the VPS disk). Memory: `MemAvailable` from
 * `/proc/meminfo` (the host's figure; containers see the host's meminfo), else Node's `os.freemem`. Read-only.
 */
import { statfs } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { freemem, totalmem } from 'node:os';
import type { UsageProviderStatus } from '@mechdost/shared/usage';

export interface ServerUsage {
  status: UsageProviderStatus;
  disk: { used: number; total: number } | null;
  memory: { used: number; total: number } | null;
}

export interface ServerProbes {
  statfs: (path: string) => Promise<{ blocks: number; bsize: number; bavail: number; bfree: number }>;
  meminfo: () => Promise<string | null>;
  os: () => { total: number; free: number };
}

const realProbes: ServerProbes = {
  statfs: async (path) => {
    const s = await statfs(path);
    return { blocks: s.blocks, bsize: s.bsize, bavail: s.bavail, bfree: s.bfree };
  },
  meminfo: () => readFile('/proc/meminfo', 'utf8').catch(() => null),
  os: () => ({ total: totalmem(), free: freemem() }),
};

const kb = (text: string, name: string): number | null => {
  const m = new RegExp(`^${name}:\\s+(\\d+) kB`, 'm').exec(text);
  return m ? Number(m[1]) * 1024 : null;
};

export async function measureServer(
  diskPath: string,
  probes: ServerProbes = realProbes,
): Promise<ServerUsage> {
  let disk: ServerUsage['disk'] = null;
  try {
    const s = await probes.statfs(diskPath);
    const total = s.blocks * s.bsize;
    // Used = total minus free blocks (what `df` shows as used, root's reserve counted as free).
    if (total > 0) disk = { used: Math.max(0, total - s.bfree * s.bsize), total };
  } catch {
    disk = null;
  }
  let memory: ServerUsage['memory'] = null;
  const info = await probes.meminfo();
  const total = info ? kb(info, 'MemTotal') : null;
  const available = info ? kb(info, 'MemAvailable') : null;
  if (total && available !== null) memory = { used: Math.max(0, total - available), total };
  else {
    const o = probes.os();
    if (o.total > 0) memory = { used: Math.max(0, o.total - o.free), total: o.total };
  }
  const status: UsageProviderStatus = disk && memory ? 'ok' : disk || memory ? 'partial' : 'failed';
  return { status, disk, memory };
}
