import { useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/api/client';
import type { Conversation, Message, QualificationData, SendMessageResponse } from '@/types';

interface UseConversationReturn {
  conversationId: string | null;
  messages: Message[];
  qualification: QualificationData | null;
  isLoading: boolean;
  isSending: boolean;
  error: string | null;
  createConversation: () => void;
  sendMessage: (content: string) => void;
  resetConversation: () => void;
  clearConversation: () => void;
  isCreating: boolean;
}

/**
 * Merges qualification data, retaining previous non-null values
 * when the new response has nulls.
 */
function mergeQualification(
  prev: QualificationData | null,
  next: QualificationData
): QualificationData {
  if (!prev) return next;

  return {
    stage: next.stage ?? prev.stage,
    detectedSegment: next.detectedSegment ?? prev.detectedSegment,
    detectedIntent: next.detectedIntent ?? prev.detectedIntent,
    mainPain: next.mainPain ?? prev.mainPain,
    recommendedService: next.recommendedService ?? prev.recommendedService,
    leadScore: next.leadScore ?? prev.leadScore,
    temperature: next.temperature ?? prev.temperature,
    status: next.status ?? prev.status,
    shouldHandoff: next.shouldHandoff ?? prev.shouldHandoff,
    handoffReason: next.handoffReason ?? prev.handoffReason,
    commercialSummary: next.commercialSummary ?? prev.commercialSummary,
    nextBestQuestion: next.nextBestQuestion ?? prev.nextBestQuestion,
    scoreReasons:
      next.scoreReasons && next.scoreReasons.length > 0
        ? next.scoreReasons
        : prev.scoreReasons,
    objections:
      next.objections && next.objections.length > 0
        ? next.objections
        : prev.objections,
    urgency: next.urgency ?? prev.urgency,
    estimatedVolume: next.estimatedVolume ?? prev.estimatedVolume,
    decisionRole: next.decisionRole ?? prev.decisionRole,
    budgetSignal: next.budgetSignal ?? prev.budgetSignal,
  };
}

export function useConversation(): UseConversationReturn {
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [qualification, setQualification] = useState<QualificationData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Query to fetch conversation data (used for rehydration if needed)
  useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: async () => {
      if (!conversationId) return null;
      const { data } = await apiClient.get<Conversation>(
        `/playground/conversations/${conversationId}`
      );
      return data;
    },
    enabled: false, // Only fetch manually if needed
  });

  // Mutation: create a new conversation
  const createMutation = useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post<Conversation>('/playground/conversations');
      return data;
    },
    onSuccess: (data) => {
      setConversationId(data.id);
      setMessages(data.messages ?? []);
      setQualification(null);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['conversation'] });
    },
    onError: () => {
      setError('Falha ao criar conversa. Tente novamente.');
    },
  });

  // Mutation: send a message
  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!conversationId) {
        throw new Error('No active conversation');
      }
      const { data } = await apiClient.post<SendMessageResponse>(
        `/playground/conversations/${conversationId}/messages`,
        { content }
      );
      return data;
    },
    onMutate: async (content: string) => {
      // Optimistically add the user message to the list
      const optimisticMessage: Message = {
        id: `temp-${Date.now()}`,
        conversationId: conversationId!,
        role: 'user',
        direction: 'inbound',
        content,
        metadata: null,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimisticMessage]);
      setError(null);
    },
    onSuccess: (data) => {
      // Replace the optimistic user message with the real one and add assistant message
      setMessages((prev) => {
        // Remove the temp user message (last user message)
        const withoutTemp = prev.filter(
          (m) => !m.id.startsWith('temp-')
        );
        // The API returns the assistant message; the user message is already persisted
        // We need to add both the real user message (inferred from context) and assistant message
        // Actually the API returns only the assistant message in `data.message`
        // The user message was already added optimistically, so we keep it but fix the id
        const userMsg = prev.find((m) => m.id.startsWith('temp-'));
        const realUserMsg: Message | undefined = userMsg
          ? { ...userMsg, id: `user-${Date.now()}` }
          : undefined;

        const result = realUserMsg
          ? [...withoutTemp, realUserMsg, data.message]
          : [...withoutTemp, data.message];
        return result;
      });

      // Merge qualification data (retain previous non-null values)
      if (data.qualification) {
        setQualification((prev) => mergeQualification(prev, data.qualification));
      }
    },
    onError: (_err) => {
      // Keep the user message in the list but show error
      setError('Falha ao enviar mensagem. O agente está temporariamente indisponível.');
    },
  });

  // Create a new conversation (closes existing one via backend)
  const createConversation = useCallback(() => {
    setMessages([]);
    setQualification(null);
    setError(null);
    createMutation.mutate();
  }, [createMutation]);

  // Send a message in the current conversation
  const sendMessage = useCallback(
    (content: string) => {
      if (!conversationId) return;
      sendMutation.mutate(content);
    },
    [conversationId, sendMutation]
  );

  // Reset conversation: closes current and creates new
  const resetConversation = useCallback(() => {
    setMessages([]);
    setQualification(null);
    setError(null);
    createMutation.mutate();
  }, [createMutation]);

  // Clear conversation: wipes messages but keeps same session/lead
  const clearConversation = useCallback(async () => {
    if (!conversationId) return;
    try {
      const { data } = await apiClient.delete<Conversation>(
        `/playground/conversations/${conversationId}/clear`
      );
      setMessages(data.messages ?? []);
      setQualification(null);
      setError(null);
    } catch {
      // Fallback: create new conversation
      setMessages([]);
      setQualification(null);
      setError(null);
      createMutation.mutate();
    }
  }, [conversationId, createMutation]);

  return {
    conversationId,
    messages,
    qualification,
    isLoading: createMutation.isPending,
    isSending: sendMutation.isPending,
    error,
    createConversation,
    sendMessage,
    resetConversation,
    clearConversation,
    isCreating: createMutation.isPending,
  };
}
