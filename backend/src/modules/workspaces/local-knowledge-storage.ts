import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, lstat, open, rename, unlink, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, relative, resolve, join, sep } from 'node:path';
import { PrivateKnowledgeStorage } from './private-knowledge-storage';

export const PDF_MAX_BYTES = 10 * 1024 * 1024;
const tenantKey = (id: string) => createHash('sha256').update(id).digest('hex');

/** Explicit local development storage. Never falls back to filesystem storage in production. */
export class LocalKnowledgeStorage extends PrivateKnowledgeStorage {
  private readonly root = process.env.KNOWLEDGE_PRIVATE_STORAGE_ROOT ?? '';
  isConfigured() {
    const outside = relative(resolve(process.cwd(), '..'), resolve(this.root));
    return process.env.KNOWLEDGE_DOCUMENTS_ENABLED === 'true' && process.env.NODE_ENV === 'development'
      && isAbsolute(this.root) && outside.startsWith('..' + sep) && this.root !== '/';
  }
  private async directory(tenant: string) {
    if (!this.isConfigured()) throw new ServiceUnavailableException({ code: 'PRIVATE_STORAGE_UNAVAILABLE', message: 'Configure private development storage outside the repository.' });
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const rootStat = await lstat(this.root);
    const actual = relative(await realpath(resolve(process.cwd(), '..')), await realpath(this.root));
    if (rootStat.isSymbolicLink() || !actual.startsWith('..' + sep) || (rootStat.mode & 0o077) !== 0) throw new Error('Private storage root must be private (0700), outside the checkout and not a symbolic link.');
    const directory = join(this.root, tenant);
    await mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const tenantStat = await lstat(directory);
    if (tenantStat.isSymbolicLink() || (tenantStat.mode & 0o077) !== 0) throw new Error('Private tenant directory must be private and not a symbolic link.');
    return directory;
  }
  private parse(key: string) {
    if (!/^[a-f0-9]{64}\/[a-f0-9-]{36}\.pdf$/.test(key)) throw new BadRequestException('Invalid private document key.');
    const [tenant, file] = key.split('/'); return { tenant: tenant!, file: file! };
  }
  async put(organizationId: string, bytes: Uint8Array, contentType: string) {
    if (contentType !== 'application/pdf' || !bytes.length || bytes.length > PDF_MAX_BYTES) throw new BadRequestException('PDF exceeds storage limits.');
    const tenant = tenantKey(organizationId), directory = await this.directory(tenant), file = `${randomUUID()}.pdf`;
    const temporary = join(directory, `${file}.pending`);
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, join(directory, file));
      return { storageKey: `${tenant}/${file}` };
    } catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
  }
  override async read(organizationId: string, storageKey: string) {
    const { tenant, file } = this.parse(storageKey);
    if (tenant !== tenantKey(organizationId)) throw new BadRequestException('Document tenant mismatch.');
    const handle = await open(join(await this.directory(tenant), file), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > PDF_MAX_BYTES) throw new BadRequestException('Invalid private PDF.');
      return new Uint8Array(await handle.readFile());
    } finally { await handle.close(); }
  }
  async delete(storageKey: string) {
    // Callers obtain this opaque key only from an authorized source record, never request input.
    const { tenant, file } = this.parse(storageKey);
    await unlink(join(await this.directory(tenant), file)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
