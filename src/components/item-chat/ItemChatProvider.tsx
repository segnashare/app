'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import {
  ITEM_CHAT_OPEN_EVENT,
  ITEM_CHAT_OPEN_PANEL_EVENT,
  loadItemChatLocalState,
  openItemChat,
  saveItemChatLocalState,
  type ItemChatLocalState,
  type OpenItemChatDetail,
} from "@/lib/item-chat/client-storage"
import {
  findNewInboundChatMessages,
  isSameChatThreadContinuation,
  makeOptimisticVisitorMessage,
  replaceOptimisticVisitorMessage,
  waitForTypingReveal,
} from "@/lib/item-chat/chat-timing"

export type ItemChatMessage = {
  id: string
  role: 'visitor' | 'staff' | 'system'
  body: string
  createdAt: string
  staffDisplayName?: string | null
  staffAvatarUrl?: string | null
}

export type ItemChatConversation = {
  id: string
  itemId: string | null
  itemTitle: string | null
  itemSizeLabel: string | null
  itemConditionLabel: string | null
  contactEmail: string | null
  status: string
  lastMessageAt: string
  lastReadAt: string | null
  unreadStaffCount: number
  hasVisitorMessage: boolean
  usefulnessPromptedAt: string | null
  usefulnessRating: 'yes' | 'no' | null
  lastMessagePreview: string | null
  operatorDisplayName: string | null
  operatorAvatarUrl: string | null
}

export type ItemChatView = 'list' | 'thread' | 'archives'

type ItemChatContextValue = {
  source: 'web' | 'app'
  apiBase: string
  panelOpen: boolean
  setPanelOpen: (open: boolean) => void
  view: ItemChatView
  goToList: () => void
  goToArchives: () => void
  startNewChat: (opts?: {initialMessage?: string}) => Promise<void>
  conversations: ItemChatConversation[]
  archivedConversations: ItemChatConversation[]
  unreadCount: number
  messages: ItemChatMessage[]
  conversation: ItemChatConversation | null
  pendingItem: OpenItemChatDetail | null
  sending: boolean
  botTyping: boolean
  error: string | null
  clearError: () => void
  openForItem: (detail: OpenItemChatDetail) => void
  openConversation: (id: string) => void
  archiveConversation: (id: string) => Promise<void>
  unarchiveConversation: (id: string) => Promise<void>
  sendMessage: (body: string) => Promise<void>
  submitUsefulnessRating: (rating: 'yes' | 'no') => Promise<void>
  markRead: () => Promise<void>
}

const ItemChatContext = createContext<ItemChatContextValue | null>(null)

async function apiFetch(
  apiBase: string,
  path: string,
  visitorId: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set('X-Segna-Chat-Visitor', visitorId)
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  return fetch(`${apiBase}${path}`, {
    ...init,
    headers,
    credentials: apiBase ? 'omit' : 'same-origin',
  })
}

type ProviderProps = {
  children: ReactNode
  source: 'web' | 'app'
  apiBase?: string
}

export function ItemChatProvider({children, source, apiBase = ''}: ProviderProps) {
  const [local, setLocal] = useState<ItemChatLocalState | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [view, setView] = useState<ItemChatView>('thread')
  const [pendingItem, setPendingItem] = useState<OpenItemChatDetail | null>(null)
  const [conversation, setConversation] = useState<ItemChatConversation | null>(null)
  const [conversations, setConversations] = useState<ItemChatConversation[]>([])
  const [archivedConversations, setArchivedConversations] = useState<ItemChatConversation[]>([])
  const [messages, setMessages] = useState<ItemChatMessage[]>([])
  const [sending, setSending] = useState(false)
  const [botTyping, setBotTyping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const claimedRef = useRef(false)
  const sendingRef = useRef(false)
  const botTypingRef = useRef(false)
  const messagesRef = useRef<ItemChatMessage[]>([])
  messagesRef.current = messages

  useEffect(() => {
    setLocal(loadItemChatLocalState())
  }, [])

  const persist = useCallback((next: ItemChatLocalState) => {
    setLocal(next)
    saveItemChatLocalState(next)
  }, [])

  const clearError = useCallback(() => setError(null), [])

  const refreshConversation = useCallback(
    async (conversationId: string, visitorId: string) => {
      if (sendingRef.current || botTypingRef.current) return
      const res = await apiFetch(
        apiBase,
        `/api/item-chat/conversations/${conversationId}/messages`,
        visitorId,
      )
      if (!res.ok) return
      const data = (await res.json()) as {
        conversation?: ItemChatConversation
        messages?: ItemChatMessage[]
      }
      if (data.conversation) setConversation(data.conversation)
      if (!Array.isArray(data.messages)) return

      const prev = messagesRef.current
      const next = data.messages
      const newInbound = findNewInboundChatMessages(prev, next)
      const shouldType =
        newInbound.length > 0 && isSameChatThreadContinuation(prev, next)

      if (!shouldType) {
        setMessages(next)
        return
      }

      const heldIds = new Set(newInbound.map((m) => m.id))
      setMessages(next.filter((m) => !heldIds.has(m.id)))
      botTypingRef.current = true
      setBotTyping(true)
      try {
        await waitForTypingReveal(Date.now())
        setMessages(next)
      } finally {
        botTypingRef.current = false
        setBotTyping(false)
      }
    },
    [apiBase],
  )

  const refreshList = useCallback(
    async (visitorId: string) => {
      const res = await apiFetch(apiBase, '/api/item-chat/conversations', visitorId)
      if (!res.ok) return
      const data = (await res.json()) as {conversations?: ItemChatConversation[]}
      if (Array.isArray(data.conversations)) setConversations(data.conversations)
    },
    [apiBase],
  )

  const refreshArchives = useCallback(
    async (visitorId: string) => {
      const res = await apiFetch(apiBase, '/api/item-chat/conversations?archived=1', visitorId)
      if (!res.ok) return
      const data = (await res.json()) as {conversations?: ItemChatConversation[]}
      if (Array.isArray(data.conversations)) setArchivedConversations(data.conversations)
    },
    [apiBase],
  )

  const goToList = useCallback(() => {
    setView('list')
    setError(null)
    const state = local ?? loadItemChatLocalState()
    void refreshList(state.visitorId)
  }, [local, refreshList])

  const goToArchives = useCallback(() => {
    setView('archives')
    setError(null)
    const state = local ?? loadItemChatLocalState()
    void refreshArchives(state.visitorId)
  }, [local, refreshArchives])

  const archiveConversation = useCallback(
    async (id: string) => {
      const state = local ?? loadItemChatLocalState()
      const prev = conversations
      setConversations((list) => list.filter((c) => c.id !== id))
      try {
        const res = await apiFetch(
          apiBase,
          `/api/item-chat/conversations/${id}/archive`,
          state.visitorId,
          {method: 'POST', body: JSON.stringify({archived: true})},
        )
        if (!res.ok) {
          setConversations(prev)
          setError('Archivage impossible')
          return
        }
        void refreshArchives(state.visitorId)
      } catch {
        setConversations(prev)
        setError('Réseau indisponible')
      }
    },
    [apiBase, conversations, local, refreshArchives],
  )

  const unarchiveConversation = useCallback(
    async (id: string) => {
      const state = local ?? loadItemChatLocalState()
      const prev = archivedConversations
      setArchivedConversations((list) => list.filter((c) => c.id !== id))
      try {
        const res = await apiFetch(
          apiBase,
          `/api/item-chat/conversations/${id}/archive`,
          state.visitorId,
          {method: 'POST', body: JSON.stringify({archived: false})},
        )
        if (!res.ok) {
          setArchivedConversations(prev)
          setError('Restauration impossible')
          return
        }
        void refreshList(state.visitorId)
      } catch {
        setArchivedConversations(prev)
        setError('Réseau indisponible')
      }
    },
    [apiBase, archivedConversations, local, refreshList],
  )

  const startNewChat = useCallback(
    async (opts?: {initialMessage?: string}) => {
      const initialMessage = opts?.initialMessage?.trim() || ''
      setError(null)
      setPendingItem(null)
      setConversation(null)
      setPanelOpen(true)
      setView('thread')

      const optimistic = initialMessage ? makeOptimisticVisitorMessage(initialMessage) : null
      setMessages(optimistic ? [optimistic as ItemChatMessage] : [])
      if (optimistic) {
        sendingRef.current = true
        setSending(true)
      }

      const state = local ?? loadItemChatLocalState()
      if (!local) setLocal(state)

      try {
        const res = await apiFetch(apiBase, '/api/item-chat/conversations', state.visitorId, {
          method: 'POST',
          body: JSON.stringify({
            visitorId: state.visitorId,
            source,
            forceNew: true,
          }),
        })
        if (!res.ok) {
          const err = (await res.json().catch(() => null)) as {error?: string} | null
          setError(err?.error || 'Impossible d’ouvrir le chat')
          if (optimistic) setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
          return
        }
        const data = (await res.json()) as {conversation?: ItemChatConversation}
        if (!data.conversation) {
          if (optimistic) setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
          return
        }
        setConversation(data.conversation)
        persist({...state, conversationId: data.conversation.id})

        if (initialMessage && optimistic) {
          const msgRes = await apiFetch(
            apiBase,
            `/api/item-chat/conversations/${data.conversation.id}/messages`,
            state.visitorId,
            {
              method: 'POST',
              body: JSON.stringify({
                visitorId: state.visitorId,
                body: initialMessage,
                source,
              }),
            },
          )
          if (!msgRes.ok) {
            const err = (await msgRes.json().catch(() => null)) as {error?: string} | null
            setError(err?.error || 'Envoi impossible')
            setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
            return
          }
          const msgData = (await msgRes.json()) as {
            message?: ItemChatMessage
            ackMessage?: ItemChatMessage | null
            conversation?: ItemChatConversation
          }
          setMessages((prev) =>
            replaceOptimisticVisitorMessage(prev, optimistic.id, msgData.message),
          )
          if (msgData.conversation) setConversation(msgData.conversation)
          if (msgData.ackMessage) {
            const typingStartedAt = Date.now()
            botTypingRef.current = true
            setBotTyping(true)
            try {
              await waitForTypingReveal(typingStartedAt)
              setMessages((prev) =>
                prev.some((m) => m.id === msgData.ackMessage!.id)
                  ? prev
                  : [...prev, msgData.ackMessage!],
              )
            } finally {
              botTypingRef.current = false
              setBotTyping(false)
            }
          }
        }
        await refreshConversation(data.conversation.id, state.visitorId)
        void refreshList(state.visitorId)
      } catch {
        setError('Réseau indisponible')
        if (optimistic) setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
      } finally {
        if (optimistic) {
          sendingRef.current = false
          setSending(false)
        }
      }
    },
    [apiBase, local, persist, refreshConversation, refreshList, source],
  )

  const openConversation = useCallback(
    async (id: string) => {
      const state = local ?? loadItemChatLocalState()
      setError(null)
      setView('thread')
      setPanelOpen(true)
      persist({...state, conversationId: id})
      await refreshConversation(id, state.visitorId)
    },
    [local, persist, refreshConversation],
  )

  const openForItem = useCallback(
    async (detail: OpenItemChatDetail) => {
      setError(null)
      setPendingItem(detail)
      setPanelOpen(true)
      setView('thread')
      setMessages([])
      const state = local ?? loadItemChatLocalState()
      if (!local) setLocal(state)

      try {
        const res = await apiFetch(apiBase, '/api/item-chat/conversations', state.visitorId, {
          method: 'POST',
          body: JSON.stringify({
            visitorId: state.visitorId,
            itemId: detail.itemId,
            source,
            itemTitle: detail.itemTitle ?? undefined,
            itemSizeLabel: detail.itemSizeLabel ?? undefined,
            itemConditionLabel: detail.itemConditionLabel ?? undefined,
          }),
        })
        if (!res.ok) {
          const err = (await res.json().catch(() => null)) as {error?: string} | null
          setError(err?.error || 'Impossible d’ouvrir le chat')
          return
        }
        const data = (await res.json()) as {conversation?: ItemChatConversation}
        if (!data.conversation) return
        setConversation(data.conversation)
        persist({...state, conversationId: data.conversation.id})
        await refreshConversation(data.conversation.id, state.visitorId)
        void refreshList(state.visitorId)
      } catch {
        setError('Réseau indisponible')
      }
    },
    [apiBase, local, persist, refreshConversation, refreshList, source],
  )

  useEffect(() => {
    const onOpen = (e: Event) => {
      const ce = e as CustomEvent<OpenItemChatDetail & {conversationId?: string}>
      const conversationId = ce.detail?.conversationId?.trim()
      if (conversationId) {
        void openConversation(conversationId)
        return
      }
      if (!ce.detail?.itemId) return
      void openForItem(ce.detail)
    }
    const onOpenPanel = () => {
      clearError()
      goToList()
      setPanelOpen(true)
    }
    window.addEventListener(ITEM_CHAT_OPEN_EVENT, onOpen)
    window.addEventListener(ITEM_CHAT_OPEN_PANEL_EVENT, onOpenPanel)
    return () => {
      window.removeEventListener(ITEM_CHAT_OPEN_EVENT, onOpen)
      window.removeEventListener(ITEM_CHAT_OPEN_PANEL_EVENT, onOpenPanel)
    }
  }, [clearError, goToList, openConversation, openForItem])

  useEffect(() => {
    if (!local || claimedRef.current) return
    claimedRef.current = true
    void (async () => {
      try {
        await apiFetch(apiBase, "/api/item-chat/claim", local.visitorId, {
          method: "POST",
          body: JSON.stringify({ visitorId: local.visitorId }),
        })
      } catch {
        /* guest ok */
      }
      await refreshList(local.visitorId)
      if (local.conversationId) {
        await refreshConversation(local.conversationId, local.visitorId)
      }
    })()
  }, [apiBase, local, refreshConversation, refreshList])

  useEffect(() => {
    if (!local) return
    const id = conversation?.id || local.conversationId
    if (!id) return
    const tick = () => {
      void refreshConversation(id, local.visitorId)
      if (view === 'list') void refreshList(local.visitorId)
      if (view === 'archives') void refreshArchives(local.visitorId)
    }
    const ms = panelOpen ? 8_000 : 25_000
    const t = window.setInterval(tick, ms)
    return () => window.clearInterval(t)
  }, [conversation?.id, local, panelOpen, refreshArchives, refreshConversation, refreshList, view])

  const markRead = useCallback(async () => {
    if (!local || !conversation) return
    const now = new Date().toISOString()
    persist({
      ...local,
      lastReadByConversation: {...local.lastReadByConversation, [conversation.id]: now},
    })
    setConversation((prev) => (prev ? {...prev, unreadStaffCount: 0, lastReadAt: now} : prev))
    try {
      await apiFetch(apiBase, `/api/item-chat/conversations/${conversation.id}/read`, local.visitorId, {
        method: 'POST',
        body: JSON.stringify({}),
      })
    } catch {
      /* ignore */
    }
  }, [apiBase, conversation, local, persist])

  useEffect(() => {
    if (panelOpen && view === 'thread' && conversation) {
      void markRead()
    }
  }, [panelOpen, view, conversation?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const sendMessage = useCallback(
    async (body: string) => {
      if (!local || sendingRef.current) return
      const trimmed = body.trim()
      if (!trimmed) return

      const optimistic = makeOptimisticVisitorMessage(trimmed) as ItemChatMessage
      setMessages((prev) => [...prev, optimistic])
      sendingRef.current = true
      setSending(true)
      setError(null)

      try {
        let conv = conversation
        if (!conv && pendingItem) {
          await openForItem(pendingItem)
          const state = loadItemChatLocalState()
          if (!state.conversationId) {
            setError('Conversation indisponible')
            setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
            return
          }
          conv = {
            id: state.conversationId,
            itemId: pendingItem.itemId,
            itemTitle: pendingItem.itemTitle ?? null,
            itemSizeLabel: pendingItem.itemSizeLabel ?? null,
            itemConditionLabel: pendingItem.itemConditionLabel ?? null,
            contactEmail: null,
            status: 'open',
            lastMessageAt: new Date().toISOString(),
            lastReadAt: null,
            unreadStaffCount: 0,
            hasVisitorMessage: false,
            usefulnessPromptedAt: null,
            usefulnessRating: null,
            lastMessagePreview: null,
            operatorDisplayName: null,
            operatorAvatarUrl: null,
          }
        }
        if (!conv) {
          setError('Impossible d’envoyer le message')
          setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
          return
        }

        const res = await apiFetch(
          apiBase,
          `/api/item-chat/conversations/${conv.id}/messages`,
          local.visitorId,
          {
            method: 'POST',
            body: JSON.stringify({
              visitorId: local.visitorId,
              body: trimmed,
              source,
            }),
          },
        )
        if (!res.ok) {
          const err = (await res.json().catch(() => null)) as {error?: string} | null
          setError(err?.error || 'Envoi impossible')
          setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
          return
        }
        const data = (await res.json()) as {
          message?: ItemChatMessage
          ackMessage?: ItemChatMessage | null
          conversation?: ItemChatConversation
        }
        setMessages((prev) => replaceOptimisticVisitorMessage(prev, optimistic.id, data.message))
        if (data.conversation) setConversation(data.conversation)
        persist({...local, conversationId: conv.id})
        void refreshList(local.visitorId)

        if (data.ackMessage) {
          const typingStartedAt = Date.now()
          botTypingRef.current = true
          setBotTyping(true)
          try {
            await waitForTypingReveal(typingStartedAt)
            setMessages((prev) =>
              prev.some((m) => m.id === data.ackMessage!.id) ? prev : [...prev, data.ackMessage!],
            )
          } finally {
            botTypingRef.current = false
            setBotTyping(false)
          }
        }
      } catch {
        setError('Réseau indisponible')
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
      } finally {
        sendingRef.current = false
        setSending(false)
        const convId = conversation?.id || local.conversationId
        if (convId) {
          void refreshConversation(convId, local.visitorId)
        }
      }
    },
    [
      apiBase,
      conversation,
      local,
      openForItem,
      pendingItem,
      persist,
      refreshConversation,
      refreshList,
      source,
    ],
  )

  const submitUsefulnessRating = useCallback(
    async (rating: 'yes' | 'no') => {
      if (!local || !conversation) return
      if (!conversation.usefulnessPromptedAt || conversation.usefulnessRating) return
      setSending(true)
      setError(null)
      try {
        const res = await apiFetch(
          apiBase,
          `/api/item-chat/conversations/${conversation.id}/usefulness`,
          local.visitorId,
          {
            method: 'POST',
            body: JSON.stringify({visitorId: local.visitorId, rating}),
          },
        )
        if (!res.ok) {
          const err = (await res.json().catch(() => null)) as {error?: string} | null
          setError(err?.error || 'Impossible d’enregistrer le retour')
          return
        }
        const data = (await res.json()) as {
          conversation?: ItemChatConversation
          messages?: ItemChatMessage[]
        }
        if (data.conversation) setConversation(data.conversation)
        if (data.messages?.length) {
          setMessages((prev) => [...prev, ...data.messages!])
        }
        void refreshList(local.visitorId)
      } catch {
        setError('Réseau indisponible')
      } finally {
        setSending(false)
      }
    },
    [apiBase, conversation, local, refreshList],
  )

  const unreadCount = useMemo(
    () => conversations.reduce((sum, c) => sum + (c.unreadStaffCount || 0), 0),
    [conversations],
  )

  const value = useMemo<ItemChatContextValue>(
    () => ({
      source,
      apiBase,
      panelOpen,
      setPanelOpen,
      view,
      goToList,
      goToArchives,
      startNewChat,
      conversations,
      archivedConversations,
      unreadCount,
      messages,
      conversation,
      pendingItem,
      sending,
      botTyping,
      error,
      clearError,
      openForItem,
      openConversation,
      archiveConversation,
      unarchiveConversation,
      sendMessage,
      submitUsefulnessRating,
      markRead,
    }),
    [
      apiBase,
      archiveConversation,
      archivedConversations,
      botTyping,
      clearError,
      conversation,
      conversations,
      error,
      goToArchives,
      goToList,
      startNewChat,
      markRead,
      messages,
      openConversation,
      openForItem,
      panelOpen,
      pendingItem,
      sendMessage,
      submitUsefulnessRating,
      sending,
      source,
      unarchiveConversation,
      unreadCount,
      view,
    ],
  )

  return <ItemChatContext.Provider value={value}>{children}</ItemChatContext.Provider>
}

export function useItemChat(): ItemChatContextValue {
  const ctx = useContext(ItemChatContext)
  if (!ctx) throw new Error('useItemChat must be used within ItemChatProvider')
  return ctx
}

export {openItemChat}
