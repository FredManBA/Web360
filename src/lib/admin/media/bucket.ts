/**
 * Lo unico que esta capa necesita de R2.
 *
 * Se declara el minimo en vez de usar `R2Bucket` entero por dos motivos: el
 * codigo dice exactamente que hace con el bucket, y los tests pueden pasar una
 * implementacion en memoria sin inventarse una veintena de metodos que nadie
 * llama. `R2Bucket` cumple esta forma, asi que el binding real encaja sin
 * conversiones.
 */

export interface MediaObjectOptions {
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
}

/** Lo que devuelve `get`: los bytes mas lo justo para servirlos. */
export interface FetchedObject {
  body: ReadableStream | null;
  httpMetadata?: { contentType?: string } | undefined;
  size: number;
}

export interface MediaBucket {
  put: (key: string, value: ArrayBuffer, options?: MediaObjectOptions) => Promise<unknown>;
  delete: (key: string) => Promise<void>;
  /** `null` cuando el objeto no esta. */
  get: (key: string) => Promise<FetchedObject | null>;
}

/* -------------------------------------------------------------------------- */
/* Implementacion en memoria                                                  */
/* -------------------------------------------------------------------------- */

export interface StoredObject {
  bytes: Uint8Array;
  contentType: string | undefined;
  customMetadata: Record<string, string>;
}

export interface MemoryBucket extends MediaBucket {
  objects: Map<string, StoredObject>;
  /** Hace fallar la siguiente escritura, para probar el camino de error. */
  failNextPut: (error?: Error) => void;
  /** Hace fallar el siguiente borrado. */
  failNextDelete: (error?: Error) => void;
}

/**
 * Bucket falso para los tests.
 *
 * Vive aqui y no en un fichero de test porque lo usan varios; es el mismo
 * criterio que `test-database.ts`. No añade dependencias.
 */
export function createMemoryBucket(): MemoryBucket {
  const objects = new Map<string, StoredObject>();

  let putFailure: Error | null = null;
  let deleteFailure: Error | null = null;

  return {
    objects,

    failNextPut(error = new Error('R2 no disponible')) {
      putFailure = error;
    },

    failNextDelete(error = new Error('R2 no disponible')) {
      deleteFailure = error;
    },

    put(key, value, options) {
      if (putFailure !== null) {
        const error = putFailure;
        putFailure = null;
        return Promise.reject(error);
      }

      objects.set(key, {
        bytes: new Uint8Array(value),
        contentType: options?.httpMetadata?.contentType,
        customMetadata: options?.customMetadata ?? {},
      });

      return Promise.resolve({ key });
    },

    delete(key) {
      if (deleteFailure !== null) {
        const error = deleteFailure;
        deleteFailure = null;
        return Promise.reject(error);
      }

      objects.delete(key);
      return Promise.resolve();
    },

    get(key) {
      const stored = objects.get(key);
      if (stored === undefined) return Promise.resolve(null);

      return Promise.resolve({
        body: new Blob([stored.bytes as unknown as BlobPart]).stream(),
        httpMetadata: { contentType: stored.contentType },
        size: stored.bytes.byteLength,
      });
    },
  };
}
