import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';

const RepositoryContext = createContext();

export const useRepository = () => useContext(RepositoryContext);

export const RepositoryProvider = ({ children }) => {
  const [repoData, setRepoData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const fetchRemote = useCallback(async (force = false) => {
    setLoading(true);
    setError(false);
    try {
      const endpoint = force ? '/repository_refresh' : '/repository_payloads';
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error();
      const data = await res.json();

      setRepoData(data);
    } catch (err) {
      console.error(err);
      setError(true);
      setRepoData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch only once on mount
  useEffect(() => {
    if (repoData === null) {
      fetchRemote();
    }
  }, [fetchRemote, repoData]);

  // filename -> { icon, author, release_notes, details_url, display_name }
  // built from all payload entries in the fetched repository data.
  const filenameMap = useMemo(() => {
    const map = {};
    if (!repoData) return map;

    const collect = (entries) => {
      if (!Array.isArray(entries)) return;
      for (const e of entries) {
        if (e && e.filename) {
          map[e.filename] = {
            icon: e.icon || null,
            author: e.author || null,
            release_notes: e.release_notes || null,
            details_url: e.details_url || null,
            display_name: e.name || null,
          };
        }
      }
    };

    if (Array.isArray(repoData.sources)) {
      repoData.sources.forEach((src) => collect(src && src.payloads));
    } else if (Array.isArray(repoData.payloads)) {
      collect(repoData.payloads);
    } else if (repoData.payloads && Array.isArray(repoData.payloads.payloads)) {
      collect(repoData.payloads.payloads);
    }
    return map;
  }, [repoData]);

  return (
    <RepositoryContext.Provider value={{ repoData, loading, error, fetchRemote, filenameMap }}>
      {children}
    </RepositoryContext.Provider>
  );
};
