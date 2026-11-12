export interface StoredFile {
  provider: string
  fileId: string
  url: string
}

export interface FileStore {
  readonly provider: string
  upload(file: Blob, name: string, signal?: AbortSignal): Promise<StoredFile>
}

export const FILE_ERROR_CODES = ['no_store', 'unsupported', 'too_large', 'too_large_to_decode', 'rejected', 'unavailable', 'failed'] as const
export type FileErrorCode = (typeof FILE_ERROR_CODES)[number]

export class FileError extends Error {
  readonly code: FileErrorCode
  constructor(code: FileErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'FileError'
    this.code = code
  }
}
