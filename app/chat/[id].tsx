import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  FlatList,
  TextInput,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { fetch } from "expo/fetch";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import Colors from "@/constants/colors";
import { getApiUrl } from "@/lib/query-client";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

let messageCounter = 0;
function generateUniqueId(): string {
  messageCounter++;
  return `msg-${Date.now()}-${messageCounter}-${Math.random().toString(36).substr(2, 9)}`;
}

const SUGGESTED_QUESTIONS = [
  { icon: "water-outline" as const, text: "How should I water this tree?" },
  { icon: "calendar-outline" as const, text: "When is the harvest season?" },
  { icon: "bug-outline" as const, text: "What pests should I watch for?" },
  { icon: "nutrition-outline" as const, text: "What fertilizer does it need?" },
];

function TypingIndicator() {
  return (
    <Animated.View entering={FadeIn.duration(300)} style={styles.typingContainer}>
      <View style={styles.assistantBubble}>
        <View style={styles.typingDots}>
          <View style={[styles.dot, styles.dot1]} />
          <View style={[styles.dot, styles.dot2]} />
          <View style={[styles.dot, styles.dot3]} />
        </View>
      </View>
    </Animated.View>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <View style={[styles.messageBubbleContainer, isUser ? styles.userContainer : styles.assistantContainer]}>
      {!isUser && (
        <View style={styles.avatarContainer}>
          <MaterialCommunityIcons name="palm-tree" size={16} color={Colors.light.forest} />
        </View>
      )}
      <View style={[isUser ? styles.userBubble : styles.assistantBubble, { maxWidth: "78%" }]}>
        <Text style={isUser ? styles.userText : styles.assistantText}>{message.content}</Text>
      </View>
    </View>
  );
}

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    id: string;
    treeClass?: string;
    confidence?: string;
    description?: string;
    isPalm?: string;
  }>();

  const sessionId = params.id;
  const treeClass = params.treeClass || "";
  const confidence = params.confidence ? parseFloat(params.confidence) : 0;
  const description = params.description || "";
  const isPalm = params.isPalm !== "false";

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [showTyping, setShowTyping] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const inputRef = useRef<TextInput>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const baseUrl = getApiUrl();
      const res = await globalThis.fetch(`${baseUrl}api/sessions/${sessionId}/messages`);
      if (res.ok) {
        const data = await res.json();
        if (data.length > 0) {
          setMessages(data.map((m: any) => ({ id: m.id.toString(), role: m.role, content: m.content })));
        } else if (description) {
          const welcomeMsg: Message = {
            id: generateUniqueId(),
            role: "assistant",
            content: isPalm
              ? `I've identified this as a **${treeClass}** palm tree with ${Math.round(confidence * 100)}% confidence.\n\n${description}\n\nFeel free to ask me anything about caring for this tree!`
              : `${description}\n\nI wasn't able to identify this as a known palm tree variety. You can still ask me general questions about date palm cultivation.`,
          };
          setMessages([welcomeMsg]);
        }
      }
    } catch (e) {
      console.error("Failed to load history:", e);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleSend = useCallback(async (text?: string) => {
    const messageText = (text || inputText).trim();
    if (!messageText || isStreaming) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInputText("");

    const currentMessages = [...messages];
    const userMessage: Message = { id: generateUniqueId(), role: "user", content: messageText };
    setMessages((prev) => [...prev, userMessage]);
    setIsStreaming(true);
    setShowTyping(true);

    let fullContent = "";
    let assistantAdded = false;

    try {
      const baseUrl = getApiUrl();
      const response = await fetch(`${baseUrl}api/sessions/${sessionId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ content: messageText }),
      });

      if (!response.ok) throw new Error("Failed to get response");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              fullContent += parsed.content;
              if (!assistantAdded) {
                setShowTyping(false);
                setMessages((prev) => [...prev, { id: generateUniqueId(), role: "assistant", content: fullContent }]);
                assistantAdded = true;
              } else {
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { ...updated[updated.length - 1], content: fullContent };
                  return updated;
                });
              }
            }
            if (parsed.error) {
              throw new Error(parsed.error);
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }
    } catch (error) {
      console.error("Chat error:", error);
      setShowTyping(false);
      if (!assistantAdded) {
        setMessages((prev) => [
          ...prev,
          { id: generateUniqueId(), role: "assistant", content: "Sorry, I encountered an error. Please try again." },
        ]);
      }
    } finally {
      setIsStreaming(false);
      setShowTyping(false);
    }
  }, [inputText, isStreaming, messages, sessionId]);

  const reversedMessages = [...messages].reverse();
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const webBottomInset = Platform.OS === "web" ? 34 : 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
      <View style={styles.navBar}>
        <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={Colors.light.forest} />
        </Pressable>
        <View style={styles.navCenter}>
          <Text style={styles.navTitle} numberOfLines={1}>
            {treeClass && treeClass !== "Unknown" ? `${treeClass} Palm` : "Palm Assistant"}
          </Text>
          {treeClass && treeClass !== "Unknown" && (
            <View style={styles.navBadge}>
              <MaterialCommunityIcons name="palm-tree" size={12} color={Colors.light.forest} />
              <Text style={styles.navBadgeText}>Identified</Text>
            </View>
          )}
        </View>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={0}>
        {isLoadingHistory ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={Colors.light.accent} />
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.welcomeContainer}>
            <MaterialCommunityIcons name="palm-tree" size={56} color={Colors.light.accent} />
            <Text style={styles.welcomeTitle}>Ask me anything</Text>
            <Text style={styles.welcomeText}>I can help with irrigation, harvesting, pest control, and more</Text>
            <View style={styles.suggestedContainer}>
              {SUGGESTED_QUESTIONS.map((q, i) => (
                <Pressable
                  key={i}
                  style={({ pressed }) => [styles.suggestedButton, pressed && { opacity: 0.7 }]}
                  onPress={() => handleSend(q.text)}
                >
                  <Ionicons name={q.icon} size={16} color={Colors.light.forest} />
                  <Text style={styles.suggestedText}>{q.text}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <FlatList
            data={reversedMessages}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <MessageBubble message={item} />}
            inverted={messages.length > 0}
            ListHeaderComponent={showTyping ? <TypingIndicator /> : null}
            contentContainerStyle={styles.messagesList}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          />
        )}

        <View style={[styles.inputContainer, { paddingBottom: Math.max(insets.bottom, webBottomInset) + 8 }]}>
          <View style={styles.inputWrapper}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={inputText}
              onChangeText={setInputText}
              placeholder="Ask about your palm tree..."
              placeholderTextColor={Colors.light.placeholder}
              multiline
              maxLength={2000}
              blurOnSubmit={false}
              onSubmitEditing={() => handleSend()}
              editable={!isStreaming}
            />
            <Pressable
              style={[styles.sendButton, (!inputText.trim() || isStreaming) && styles.sendButtonDisabled]}
              onPress={() => {
                handleSend();
                inputRef.current?.focus();
              }}
              disabled={!inputText.trim() || isStreaming}
            >
              <Ionicons
                name="arrow-up"
                size={18}
                color={inputText.trim() && !isStreaming ? Colors.light.white : Colors.light.placeholder}
              />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
    backgroundColor: Colors.light.surface,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  navCenter: {
    flex: 1,
    alignItems: "center",
  },
  navTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
  },
  navBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
    backgroundColor: Colors.light.accentLight + "40",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  navBadgeText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: Colors.light.forest,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  welcomeContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 30,
    gap: 8,
  },
  welcomeTitle: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
    marginTop: 12,
  },
  welcomeText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  suggestedContainer: {
    width: "100%",
    marginTop: 20,
    gap: 8,
  },
  suggestedButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: Colors.light.surface,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  suggestedText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: Colors.light.text,
  },
  messagesList: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  messageBubbleContainer: {
    flexDirection: "row",
    marginBottom: 12,
    alignItems: "flex-end",
    gap: 8,
  },
  userContainer: {
    justifyContent: "flex-end",
  },
  assistantContainer: {
    justifyContent: "flex-start",
  },
  avatarContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.light.accentLight + "40",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  userBubble: {
    backgroundColor: Colors.light.userBubble,
    borderRadius: 18,
    borderBottomRightRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginLeft: "auto",
  },
  assistantBubble: {
    backgroundColor: Colors.light.assistantBubble,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  userText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: Colors.light.userBubbleText,
    lineHeight: 21,
  },
  assistantText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: Colors.light.assistantBubbleText,
    lineHeight: 21,
  },
  typingContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    marginBottom: 12,
  },
  typingDots: {
    flexDirection: "row",
    gap: 4,
    paddingVertical: 4,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: Colors.light.textSecondary,
    opacity: 0.5,
  },
  dot1: { opacity: 0.3 },
  dot2: { opacity: 0.5 },
  dot3: { opacity: 0.7 },
  inputContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    backgroundColor: Colors.light.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "flex-end",
    backgroundColor: Colors.light.inputBackground,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.light.border,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 4,
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: Colors.light.text,
    maxHeight: 100,
    paddingVertical: 8,
  },
  sendButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.light.forest,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  sendButtonDisabled: {
    backgroundColor: Colors.light.surfaceSecondary,
  },
});
