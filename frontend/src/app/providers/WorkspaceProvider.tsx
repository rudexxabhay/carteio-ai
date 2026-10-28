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
  const [loadedForUserId, setLoadedForUserId] = useState<string | null>(null);
  const requestId = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    const userId = user?.id ?? null;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const currentId = ++requestId.current;
    setLoading(true);
    setError(null);
    setLoadedForUserId(null);
    try {
      const result = await listAllWorkspaces(controller.signal);
      if (requestId.current === currentId) { setWorkspaces(result); setLoadedForUserId(userId); }
    } catch (cause) {
      if (requestId.current !== currentId || controller.signal.aborted) return;
      setWorkspaces([]);
      setLoadedForUserId(userId);
      setError(cause instanceof ApiError
        ? cause.status === 401 ? 'Your session has ended. Sign in again to continue.'
          : cause.status === 403 ? 'Your account is not allowed to view these workspaces.'
            : cause.kind === 'network' ? 'Carteio could not reach the server. Check your internet connection and retry.'
              : cause.kind === 'timeout' ? 'The workspace request timed out. Check your connection and retry.'
                : 'We could not load your workspaces. Retry the request.'
        : 'We could not load your workspaces. Retry the request.');
    } finally {
      if (requestId.current === currentId) setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    setWorkspaces([]);
    setLoadedForUserId(null);
    void reload();
    return () => { requestId.current += 1; controllerRef.current?.abort(); };
  }, [reload, user?.id]);

  const remember = useCallback((slug: string) => {
    setLastSlug(slug);
    try { window.localStorage.setItem(storageKey, slug); } catch { /* Workspace access remains server-authorized if storage is unavailable. */ }
  }, []);

  const currentUserDataReady = loadedForUserId === user?.id;
  const visibleWorkspaces = currentUserDataReady ? workspaces : [];
  const value = useMemo(() => ({ workspaces: visibleWorkspaces, loading: loading || !currentUserDataReady, error: currentUserDataReady ? error : null, reload, remember, lastSlug }), [visibleWorkspaces, loading, currentUserDataReady, error, reload, remember, lastSlug]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useWorkspaces() {
  const value = useContext(Context);
  if (!value) throw new Error('useWorkspaces must be used within WorkspaceProvider');
  return value;
}
