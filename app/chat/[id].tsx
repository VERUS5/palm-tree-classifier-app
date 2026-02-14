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
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { fetch } from "expo/fetch";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { getApiUrl } from "@/lib/query-client";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { type ThemeColors } from "@/constants/colors";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  image?: string;
}

let messageCounter = 0;
function generateUniqueId(): string {
  messageCounter++;
  return `msg-${Date.now()}-${messageCounter}-${Math.random().toString(36).substr(2, 9)}`;
}

const treeNamesAr: Record<string, string> = {
  Khalas: "خلاص",
  Razeez: "رزيز",
  Shishi: "شيشي",
};

function TypingIndicator({ colors }: { colors: ThemeColors }) {
  return (
    <Animated.View entering={FadeIn.duration(300)} style={styles.typingContainer}>
      <View style={[styles.assistantBubble, { backgroundColor: colors.assistantBubble }]}>
        <View style={styles.typingDots}>
          <View style={[styles.dot, styles.dot1, { backgroundColor: colors.textSecondary }]} />
          <View style={[styles.dot, styles.dot2, { backgroundColor: colors.textSecondary }]} />
          <View style={[styles.dot, styles.dot3, { backgroundColor: colors.textSecondary }]} />
        </View>
      </View>
    </Animated.View>
  );
}

function MessageBubble({ message, isRTL, colors }: { message: Message; isRTL: boolean; colors: ThemeColors }) {
  const isUser = message.role === "user";
  return (
    <View style={[styles.messageBubbleContainer, isUser ? styles.userContainer : styles.assistantContainer]}>
      {!isUser && (
        <View style={[styles.avatarContainer, { backgroundColor: colors.accentLight + "40" }]}>
          <MaterialCommunityIcons name="palm-tree" size={16} color={colors.forest} />
        </View>
      )}
      <View style={[isUser ? [styles.userBubble, { backgroundColor: colors.userBubble }] : [styles.assistantBubble, { backgroundColor: colors.assistantBubble }], { maxWidth: "78%" }]}>
        {message.image && (
          <Image
            source={{ uri: message.image }}
            style={styles.messageImage}
            resizeMode="cover"
          />
        )}
        <Text style={[isUser ? [styles.userText, { color: colors.userBubbleText }] : [styles.assistantText, { color: colors.assistantBubbleText }], isRTL && styles.textRTL]}>{message.content}</Text>
      </View>
    </View>
  );
}

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const { t, lang, isRTL } = useI18n();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{
    id: string;
    treeClass?: string;
    confidence?: string;
    description?: string;
    isPalm?: string;
    source?: string;
    imageBase64?: string;
    imageMimeType?: string;
  }>();

  const sessionId = params.id;
  const treeClass = params.treeClass || "";
  const confidence = params.confidence ? parseFloat(params.confidence) : 0;
  const description = params.description || "";
  const isPalm = params.isPalm !== "false";
  const source = params.source || "";
  const imageBase64 = params.imageBase64 || "";
  const imageMimeType = params.imageMimeType || "image/jpeg";

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [showTyping, setShowTyping] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const inputRef = useRef<TextInput>(null);
  const initializedRef = useRef(false);

  const suggestedQuestions = [
    { icon: "water-outline" as const, text: t.suggestedWater },
    { icon: "calendar-outline" as const, text: t.suggestedHarvest },
    { icon: "bug-outline" as const, text: t.suggestedPests },
    { icon: "nutrition-outline" as const, text: t.suggestedFertilizer },
  ];

  const getTreeDisplayName = () => {
    if (!treeClass || treeClass === "Unknown") {
      return t.palmAssistant;
    }
    const name = isRTL ? (treeNamesAr[treeClass] || treeClass) : treeClass;
    return isRTL ? `${t.palm} ${name}` : `${name} ${t.palm}`;
  };

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
          const treeName = isRTL ? (treeNamesAr[treeClass] || treeClass) : treeClass;
          const isConvNeXt = source === "convnext_ensemble";
          const sourceLabel = isConvNeXt
            ? isRTL ? "نموذج ConvNeXt المحلي" : "ConvNeXt AI Model"
            : isRTL ? "الذكاء الاصطناعي جيميني" : "Gemini Vision";
          const imageUri = imageBase64 ? `data:${imageMimeType};base64,${imageBase64}` : undefined;
          const welcomeContent = isPalm
            ? isRTL
              ? `تم التعرف على هذه النخلة على أنها **${treeName}** بنسبة ثقة ${Math.round(confidence * 100)}%.\n[${sourceLabel}]\n\n${description}\n\nلا تتردد في سؤالي عن أي شيء يخص رعاية هذه النخلة!`
              : `I've identified this as a **${treeClass}** palm tree with ${Math.round(confidence * 100)}% confidence.\n[${sourceLabel}]\n\n${description}\n\nFeel free to ask me anything about caring for this tree!`
            : isRTL
              ? `${description}\n\nلم أتمكن من تحديد هذه الصورة كنوع معروف من النخيل. يمكنك سؤالي عن زراعة النخيل بشكل عام.`
              : `${description}\n\nI wasn't able to identify this as a known palm tree variety. You can still ask me general questions about date palm cultivation.`;
          const welcomeMsg: Message = {
            id: generateUniqueId(),
            role: "assistant",
            content: welcomeContent,
            image: imageUri,
          };
          setMessages([welcomeMsg]);
          globalThis.fetch(`${baseUrl}api/sessions/${sessionId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: "assistant", content: welcomeContent }),
          }).catch(() => {});
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
        body: JSON.stringify({ content: messageText, lang }),
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
          { id: generateUniqueId(), role: "assistant", content: t.errorResponse },
        ]);
      }
    } finally {
      setIsStreaming(false);
      setShowTyping(false);
    }
  }, [inputText, isStreaming, messages, sessionId, lang, t]);

  const reversedMessages = [...messages].reverse();
  const webTopInset = Platform.OS === "web" ? 67 : 0;
  const webBottomInset = Platform.OS === "web" ? 34 : 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + webTopInset }]}>
      <View style={[styles.navBar, { borderBottomColor: colors.border, backgroundColor: colors.surface }, isRTL && styles.rowReverse]}>
        <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={12}>
          <Ionicons name={isRTL ? "chevron-forward" : "chevron-back"} size={24} color={colors.forest} />
        </Pressable>
        <View style={styles.navCenter}>
          <Text style={[styles.navTitle, { color: colors.text }, isRTL && styles.textRTL]} numberOfLines={1}>
            {getTreeDisplayName()}
          </Text>
          {treeClass && treeClass !== "Unknown" && (
            <View style={[styles.navBadge, { backgroundColor: colors.accentLight + "40" }, isRTL && styles.rowReverse]}>
              <MaterialCommunityIcons name="palm-tree" size={12} color={colors.forest} />
              <Text style={[styles.navBadgeText, { color: colors.forest }]}>{t.identified}</Text>
            </View>
          )}
        </View>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={0}>
        {isLoadingHistory ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.welcomeContainer}>
            <MaterialCommunityIcons name="palm-tree" size={56} color={colors.accent} />
            <Text style={[styles.welcomeTitle, { color: colors.text }, isRTL && styles.textRTL]}>{t.askAnything}</Text>
            <Text style={[styles.welcomeText, { color: colors.textSecondary }, isRTL && styles.textRTL]}>{t.askAnythingDesc}</Text>
            <View style={styles.suggestedContainer}>
              {suggestedQuestions.map((q, i) => (
                <Pressable
                  key={i}
                  style={({ pressed }) => [styles.suggestedButton, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && { opacity: 0.7 }, isRTL && styles.rowReverse]}
                  onPress={() => handleSend(q.text)}
                >
                  <Ionicons name={q.icon} size={16} color={colors.forest} />
                  <Text style={[styles.suggestedText, { color: colors.text }, isRTL && styles.textRTL]}>{q.text}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <FlatList
            data={reversedMessages}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <MessageBubble message={item} isRTL={isRTL} colors={colors} />}
            inverted={messages.length > 0}
            ListHeaderComponent={showTyping ? <TypingIndicator colors={colors} /> : null}
            contentContainerStyle={styles.messagesList}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          />
        )}

        <View style={[styles.inputContainer, { backgroundColor: colors.surface, borderTopColor: colors.border }, { paddingBottom: Math.max(insets.bottom, webBottomInset) + 8 }]}>
          <View style={[styles.inputWrapper, { backgroundColor: colors.inputBackground, borderColor: colors.border }, isRTL && styles.rowReverse]}>
            <TextInput
              ref={inputRef}
              style={[styles.input, { color: colors.text }, isRTL && styles.textRTL]}
              value={inputText}
              onChangeText={setInputText}
              placeholder={t.askPlaceholder}
              placeholderTextColor={colors.placeholder}
              multiline
              maxLength={2000}
              blurOnSubmit={false}
              onSubmitEditing={() => handleSend()}
              editable={!isStreaming}
              textAlign={isRTL ? "right" : "left"}
            />
            <Pressable
              style={[styles.sendButton, { backgroundColor: colors.forest }, (!inputText.trim() || isStreaming) && { backgroundColor: colors.surfaceSecondary }]}
              onPress={() => {
                handleSend();
                inputRef.current?.focus();
              }}
              disabled={!inputText.trim() || isStreaming}
            >
              <Ionicons
                name="arrow-up"
                size={18}
                color={inputText.trim() && !isStreaming ? colors.white : colors.placeholder}
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
  },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
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
  },
  navBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  navBadgeText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
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
    marginTop: 12,
  },
  welcomeText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
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
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  suggestedText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
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
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  userBubble: {
    borderRadius: 18,
    borderBottomRightRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginLeft: "auto",
  },
  assistantBubble: {
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
    lineHeight: 21,
  },
  assistantText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    lineHeight: 21,
  },
  messageImage: {
    width: 240,
    height: 180,
    borderRadius: 12,
    marginBottom: 8,
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
    opacity: 0.5,
  },
  dot1: { opacity: 0.3 },
  dot2: { opacity: 0.5 },
  dot3: { opacity: 0.7 },
  inputContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    borderTopWidth: 1,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderRadius: 24,
    borderWidth: 1,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 4,
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    maxHeight: 100,
    paddingVertical: 8,
  },
  sendButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  rowReverse: {
    flexDirection: "row-reverse",
  },
  textRTL: {
    textAlign: "right",
    writingDirection: "rtl",
  },
});
