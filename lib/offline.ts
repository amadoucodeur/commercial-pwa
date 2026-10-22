import type { SupabaseClient } from "@supabase/supabase-js";

// Stockage local (IndexedDB) des données consultées et des saisies faites hors connexion.
const nomBase = "trabad-commercial";
const nomStore = "kv";

function ouvrir() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const requete = indexedDB.open(nomBase, 1);
    requete.onupgradeneeded = () => requete.result.createObjectStore(nomStore);
    requete.onsuccess = () => resolve(requete.result);
    requete.onerror = () => reject(requete.error);
  });
}

async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest) {
  const base = await ouvrir();
  try {
    return await new Promise<T>((resolve, reject) => {
      const requete = action(base.transaction(nomStore, mode).objectStore(nomStore));
      requete.onsuccess = () => resolve(requete.result as T);
      requete.onerror = () => reject(requete.error);
    });
  } finally { base.close(); }
}

export async function lireLocal<T>(cle: string): Promise<T | undefined> {
  try { return await transaction<T | undefined>("readonly", (store) => store.get(cle)); } catch { return undefined; }
}

export async function ecrireLocal(cle: string, valeur: unknown) {
  try { await transaction("readwrite", (store) => store.put(valeur, cle)); } catch { /* stockage indisponible : l'app reste utilisable en ligne */ }
}

export async function viderLocal() {
  try { await transaction("readwrite", (store) => store.clear()); } catch { /* rien à vider */ }
}

export type OperationHorsLigne = { id: string; libelle: string; creeLe: string } & (
  | { type: "rpc"; fn: string; args: Record<string, unknown> }
  | { type: "update"; table: string; ligneId: string; valeurs: Record<string, unknown> }
  | { type: "insert"; table: string; valeurs: Record<string, unknown> }
);

export type OperationSansMeta = OperationHorsLigne extends infer O ? O extends OperationHorsLigne ? Omit<O, "id" | "creeLe"> : never : never;

export const idLocal = () => `local-${crypto.randomUUID()}`;
export const estLocal = (id: string | null | undefined) => !!id?.startsWith("local-");

export function envoyerOperation(client: SupabaseClient, operation: OperationSansMeta) {
  if (operation.type === "rpc") return client.rpc(operation.fn, operation.args);
  if (operation.type === "update") return client.from(operation.table).update(operation.valeurs).eq("id", operation.ligneId);
  return client.from(operation.table).insert(operation.valeurs);
}

// Réseau coupé, session expirée ou serveur indisponible : l'opération sera retentée plus tard.
export const echecTemporaire = (status: number) =>
  status === 0 || status === 401 || status === 408 || status === 429 || status >= 500;
