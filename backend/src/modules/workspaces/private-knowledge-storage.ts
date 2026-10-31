import { Injectable, ServiceUnavailableException } from '@nestjs/common';

/** Legacy private-file cleanup/read boundary. New PDF uploads must never persist original file bytes. */
export abstract class PrivateKnowledgeStorage {
  abstract isConfigured(): boolean;
  abstract delete(storageKey: string): Promise<void>;
  async read(_organizationId: string, _storageKey: string): Promise<Uint8Array> {
    throw new ServiceUnavailableException({ code: 'PRIVATE_STORAGE_UNAVAILABLE', message: 'Private document reads are not configured.' });
  }
}

/** Safe Phase 07 adapter while no durable private object store is configured. */
@Injectable()
export class UnconfiguredPrivateKnowledgeStorage extends PrivateKnowledgeStorage {
  isConfigured(): boolean { return false; }
  async delete(_storageKey: string): Promise<void> {
    throw new ServiceUnavailableException({ code: 'PRIVATE_STORAGE_UNAVAILABLE', message: 'Private document storage is not configured.' });
  }
}
