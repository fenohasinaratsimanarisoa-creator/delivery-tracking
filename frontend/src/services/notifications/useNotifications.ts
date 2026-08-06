import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/client';
import { getAccessToken } from '../auth/tokenStore';
import type { Notification } from '../../types';
import { useNotificationSocket } from './notificationsSocket';

type UnreadPayload = { count: number };

const LIST_PREFIX = ['notifications', 'list'] as const;
const UNREAD_KEY = ['notifications', 'unread-count'] as const;

function normalizeNotification(n: Notification): Notification {
  return { ...n };
}

const NOW = () => new Date().toISOString();

export interface UseNotificationsOptions {
  limit?: number;
}

export function useNotifications(options: UseNotificationsOptions = {}) {
  const limit = options.limit ?? 20;
  const listKey = [...LIST_PREFIX, limit];
  const queryClient = useQueryClient();
  const token = getAccessToken();

  const { data: notifications, refetch: refetchList, isFetching } = useQuery<Notification[]>({
    queryKey: listKey,
    queryFn: () =>
      api.get(`/notifications?limit=${limit}`).then((r) => (r.data ?? []).map(normalizeNotification)),
    enabled: !!token,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const { data: unreadData, refetch: refetchUnread } = useQuery<UnreadPayload>({
    queryKey: [...UNREAD_KEY],
    queryFn: () => api.get('/notifications/unread-count').then((r) => r.data as UnreadPayload),
    enabled: !!token,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const { connected } = useNotificationSocket(() => {
    refetchList();
    refetchUnread();
  });

  function invalidateNotifications() {
    queryClient.invalidateQueries({ queryKey: ['notifications', 'list'] });
    queryClient.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
  }

  const markRead = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`).then((r) => r.data),
    onMutate: (id) => {
      queryClient.setQueriesData({ queryKey: ['notifications', 'list'] }, (prev: unknown) => {
        const arr = (Array.isArray(prev) ? prev : []) as Notification[];
        return arr.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: NOW() } : n));
      });
      const current = queryClient.getQueryData(['notifications', 'unread-count']) as UnreadPayload | undefined;
      if (current?.count) {
        queryClient.setQueryData(['notifications', 'unread-count'], { count: Math.max(0, current.count - 1) });
      }
    },
    onError: invalidateNotifications,
  });

  const markAllRead = useMutation({
    mutationFn: () => api.patch('/notifications/read-all').then((r) => r.data),
    onMutate: () => {
      queryClient.setQueriesData({ queryKey: ['notifications', 'list'] }, (prev: unknown) =>
        ((Array.isArray(prev) ? prev : []) as Notification[]).map((n) => (n.readAt ? n : { ...n, readAt: NOW() })),
      );
      queryClient.setQueryData(['notifications', 'unread-count'], { count: 0 });
    },
    onError: invalidateNotifications,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/notifications/${id}`).then((r) => r.data),
    onMutate: (id: string) => {
      let removedUnread = false;
      queryClient.setQueriesData({ queryKey: ['notifications', 'list'] }, (prev: unknown) => {
        const arr = (Array.isArray(prev) ? prev : []) as Notification[];
        const target = arr.find((n) => n.id === id);
        if (target && !target.readAt) removedUnread = true;
        return arr.filter((n) => n.id !== id);
      });
      if (removedUnread) {
        const current = queryClient.getQueryData(['notifications', 'unread-count']) as UnreadPayload | undefined;
        if (current?.count) {
          queryClient.setQueryData(['notifications', 'unread-count'], { count: Math.max(0, current.count - 1) });
        }
      }
    },
    onError: invalidateNotifications,
  });

  const removeAll = useMutation({
    mutationFn: () => api.delete('/notifications').then((r) => r.data),
    onMutate: () => {
      queryClient.setQueriesData({ queryKey: ['notifications', 'list'] }, () => []);
      queryClient.setQueryData(['notifications', 'unread-count'], { count: 0 });
    },
    onError: invalidateNotifications,
  });

  const unreadCount = unreadData?.count ?? 0;

  return {
    notifications: notifications ?? [],
    unreadCount,
    connected,
    isLoading: isFetching && !notifications,
    refetch: () => { refetchList(); refetchUnread(); },
    markRead: markRead.mutate,
    markAllRead: markAllRead.mutate,
    remove: remove.mutate,
    removeAll: removeAll.mutate,
    isMutating: markRead.isPending || markAllRead.isPending || remove.isPending || removeAll.isPending,
  };
}