import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from './AuthProvider';
import { ApiError } from '../../services/api/client';
import { listAllWorkspaces, type Workspace } from '../../services/api/workspaces';

const storageKey = 'carteio:last-authorized-workspace';
type WorkspaceState = { workspaces: Workspace[]; loading: boolean; error: string | null; reload: () => Promise<void>; remember: (slug: string) => void; lastSlug: string | null; };
const Context = createContext<WorkspaceState | null>(null);

function storedSlug() {
  try { return window.localStorage.getItem(storageKey); } catch { return null; }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSlug, setLastSlug] = useState<string | null>(storedSlug);
  const requestId = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const currentId = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await listAllWorkspaces(controller.signal);
      if (requestId.current === currentId) setWorkspaces(result);
    } catch (cause) {
      if (requestId.current !== currentId || controller.signal.aborted) return;
      setWorkspaces([]);
      setError(cause instanceof ApiError && cause.status === 401 ? 'Your session has ended. Sign in again to continue.' : 'We could not load your workspaces. Please try again.');
    } finally {
      if (requestId.current === currentId) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setWorkspaces([]);
    void reload();
    return () => { requestId.current += 1; controllerRef.current?.abort(); };
  }, [reload, user?.id]);

  const remember = useCallback((slug: string) => {
    setLastSlug(slug);
    try { window.localStorage.setItem(storageKey, slug); } catch { /* Workspace access remains server-authorized if storage is unavailable. */ }
  }, []);

  const value = useMemo(() => ({ workspaces, loading, error, reload, remember, lastSlug }), [workspaces, loading, error, reload, remember, lastSlug]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useWorkspaces() {
  const value = useContext(Context);
  if (!value) throw new Error('useWorkspaces must be used within WorkspaceProvider');
  return value;
}
