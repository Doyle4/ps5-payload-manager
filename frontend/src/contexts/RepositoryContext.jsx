import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const RepositoryContext = createContext();

export const useRepository = () => useContext(RepositoryContext);

export const RepositoryProvider = ({ children, config }) => {
  const [repoData, setRepoData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  // Safely check if config exists before checking MULTI_SOURCES_ENABLED
  const multiSources = config?.MULTI_SOURCES_ENABLED === true;

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
  }, [multiSources]);

  // Fetch only once when config is loaded
  useEffect(() => {
    if (config && Object.keys(config).length > 0) {
      if (repoData === null) {
        fetchRemote();
      }
    }
  }, [config, fetchRemote, repoData]);

  return (
    <RepositoryContext.Provider value={{ repoData, loading, error, fetchRemote }}>
      {children}
    </RepositoryContext.Provider>
  );
};
