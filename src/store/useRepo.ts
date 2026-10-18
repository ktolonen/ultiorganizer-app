import { useEffect, useState } from 'react';
import { getRepo } from './sqlite';
import type { Repo } from './repo';

/** The repository once the database is open and migrated; null while loading. */
export function useRepo(): Repo | null {
  const [repo, setRepo] = useState<Repo | null>(null);
  useEffect(() => {
    let live = true;
    void getRepo().then((r) => live && setRepo(r));
    return () => {
      live = false;
    };
  }, []);
  return repo;
}
