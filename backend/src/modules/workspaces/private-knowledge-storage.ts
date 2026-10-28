import { Injectable, ServiceUnavailableException } from '@nestjs/common';

/** Server-only boundary for private object storage. Implementations must use generated keys and private buckets. */
export abstract class PrivateKnowledgeStorage {
  abstract isConfigured(): boolean;
  abstract put(organizationId: string, bytes: Uint8Array, contentType: string): Promise<{ storageKey: string }>;
  abstract delete(storageKey: string): Promise<void>;
  async read(_organizationId: string, _storageKey: string): Promise<Uint8Array> {
    throw new ServiceUnavailableException({ code: 'PRIVATE_STORAGE_UNAVAILABLE', message: 'Private document reads are not configured.' });
  }
}

/** Safe Phase 07 adapter while no durable private object store is configured. */
@Injectable()
export class UnconfiguredPrivateKnowledgeStorage extends PrivateKnowledgeStorage {
  isConfigured(): boolean { return false; }
  async put(_organizationId: string, _bytes: Uint8Array, _contentType: string): Promise<{ storageKey: string }> {
    throw new ServiceUnavailableException({ code: 'PRIVATE_STORAGE_UNAVAILABLE', message: 'Private document storage is not configured.' });
  }
  async delete(_storageKey: string): Promise<void> {
    throw new ServiceUnavailableException({ code: 'PRIVATE_STORAGE_UNAVAILABLE', message: 'Private document storage is not configured.' });
  }
}
