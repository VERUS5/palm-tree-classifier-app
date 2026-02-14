import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  FlatList,
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { getApiUrl } from "@/lib/query-client";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

interface Session {
  id: number;
  treeClass: string | null;
  title: string;
  createdAt: string;
}

interface ClassificationResult {
  isPalm: boolean;
  class: string;
  confidence: number;
  description: string;
  source?: string;
  probabilities?: Record<string, number>;
  folds_used?: number;
}

const treeIcons: Record<string, string> = {
  Khalas: "leaf",
  Razeez: "flower-outline",
  Shishi: "nutrition",
};

const treeNamesAr: Record<string, string> = {
  Khalas: "خلاص",
  Razeez: "رزيز",
  Shishi: "شيشي",
};

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { t, lang, isRTL, toggleLanguage } = useI18n();
  const { colors, isDark, toggleTheme } = useTheme();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isClassifying, setIsClassifying] = useState(false);

  const fetchSessions = useCallback(async () => {
    try {
      const baseUrl = getApiUrl();
      const res = await fetch(`${baseUrl}api/sessions`);
      if (res.ok) {
        const data = await res.json();
        setSessions(data);
      }
    } catch (e) {
      console.error("Failed to fetch sessions:", e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchSessions();
    }, [fetchSessions])
  );

  const pickImage = async (source: "camera" | "gallery") => {
    let result;
    if (source === "camera") {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(t.permissionNeeded, t.cameraPermission);
        return;
      }
      result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        quality: 0.8,
        base64: true,
      });
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(t.permissionNeeded, t.galleryPermission);
        return;
      }
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.8,
        base64: true,
      });
    }

    if (result && !result.canceled && result.assets[0]) {
      await classifyImage(result.assets[0]);
    }
  };

  const classifyImage = async (asset: ImagePicker.ImagePickerAsset) => {
    setIsClassifying(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const baseUrl = getApiUrl();

      if (!asset.base64) {
        Alert.alert(t.error, t.imageError);
        return;
      }

      const uri = asset.uri;
      const filename = uri.split("/").pop() || "photo.jpg";
      const match = /\.(\w+)$/.exec(filename);
      const type = match ? `image/${match[1]}` : "image/jpeg";

      const classifyRes = await fetch(`${baseUrl}api/classify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base64: asset.base64,
          mimeType: type,
          lang,
        }),
      });

      if (!classifyRes.ok) throw new Error("Classification failed");

      const classification: ClassificationResult = await classifyRes.json();

      const treeName = isRTL
        ? treeNamesAr[classification.class] || classification.class
        : classification.class;

      const title = classification.isPalm
        ? `${treeName} ${isRTL ? "نخلة" : "Palm"} (${Math.round(classification.confidence * 100)}%)`
        : t.unidentified;

      const sessionRes = await fetch(`${baseUrl}api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          treeClass: classification.class,
          imageData: null,
          title,
        }),
      });

      if (!sessionRes.ok) throw new Error("Failed to create session");
      const session = await sessionRes.json();

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      router.push({
        pathname: "/chat/[id]",
        params: {
          id: session.id.toString(),
          treeClass: classification.class,
          confidence: classification.confidence.toString(),
          description: classification.description,
          isPalm: classification.isPalm.toString(),
          source: classification.source || "gemini_vision",
          imageBase64: asset.base64,
          imageMimeType: type,
        },
      });
    } catch (error) {
      console.error("Classification error:", error);
      Alert.alert(t.error, t.classifyError);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsClassifying(false);
    }
  };

  const deleteSession = async (id: number) => {
    try {
      const baseUrl = getApiUrl();
      await fetch(`${baseUrl}api/sessions/${id}`, { method: "DELETE" });
      setSessions((prev) => prev.filter((s) => s.id !== id));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e) {
      console.error("Failed to delete session:", e);
    }
  };

  const confirmDelete = (id: number) => {
    if (Platform.OS === "web") {
      deleteSession(id);
      return;
    }
    Alert.alert(t.deleteSession, t.deleteConfirm, [
      { text: t.cancel, style: "cancel" },
      { text: t.delete, style: "destructive", onPress: () => deleteSession(id) },
    ]);
  };

  const clearAllSessions = async () => {
    try {
      const baseUrl = getApiUrl();
      for (const s of sessions) {
        await fetch(`${baseUrl}api/sessions/${s.id}`, { method: "DELETE" });
      }
      setSessions([]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.error("Failed to clear sessions:", e);
    }
  };

  const confirmClearAll = () => {
    if (Platform.OS === "web") {
      clearAllSessions();
      return;
    }
    Alert.alert(t.clearAll, t.clearAllConfirm, [
      { text: t.cancel, style: "cancel" },
      { text: t.clearAll, style: "destructive", onPress: clearAllSessions },
    ]);
  };

  const getTreeDisplayName = (treeClass: string | null) => {
    if (!treeClass) return "";
    if (isRTL) return treeNamesAr[treeClass] || treeClass;
    return treeClass;
  };

  const renderSession = ({ item }: { item: Session }) => {
    const iconName = treeIcons[item.treeClass || ""] || "help-circle-outline";
    const date = new Date(item.createdAt);
    const timeStr = date.toLocaleDateString(isRTL ? "ar-SA" : undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    return (
      <Pressable
        style={({ pressed }) => [styles.sessionCard, { backgroundColor: colors.surface }, pressed && styles.sessionCardPressed, isRTL && styles.rowReverse]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push({ pathname: "/chat/[id]", params: { id: item.id.toString(), treeClass: item.treeClass || "" } });
        }}
        onLongPress={() => confirmDelete(item.id)}
      >
        <View style={[styles.sessionIcon, { backgroundColor: item.treeClass ? colors.accentLight + "40" : colors.surfaceSecondary }]}>
          <Ionicons name={iconName as any} size={22} color={item.treeClass ? colors.tint : colors.textSecondary} />
        </View>
        <View style={[styles.sessionInfo, isRTL && { alignItems: "flex-end" }]}>
          <Text style={[styles.sessionTitle, { color: colors.text }, isRTL && styles.textRTL]} numberOfLines={1}>{item.title}</Text>
          <Text style={[styles.sessionTime, { color: colors.textSecondary }, isRTL && styles.textRTL]}>{timeStr}</Text>
        </View>
        <Ionicons name={isRTL ? "chevron-back" : "chevron-forward"} size={18} color={colors.textSecondary} />
      </Pressable>
    );
  };

  const webTopInset = Platform.OS === "web" ? 67 : 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + webTopInset }]}>
      <View style={[styles.header, isRTL && styles.rowReverse]}>
        <View style={[styles.headerTitleWrap, isRTL ? { alignItems: "flex-end" } : undefined]}>
          <Text style={[styles.headerTitle, { color: colors.text }, isRTL && styles.textRTL]} numberOfLines={1}>{t.appName}</Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }, isRTL && styles.textRTL]} numberOfLines={1}>{t.subtitle}</Text>
        </View>
        <View style={[styles.headerActions, isRTL && styles.rowReverse]}>
          <Pressable
            onPress={toggleTheme}
            style={({ pressed }) => [styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name={isDark ? "sunny" : "moon"} size={18} color={colors.tint} />
          </Pressable>
          <Pressable
            onPress={toggleLanguage}
            style={({ pressed }) => [styles.langButton, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="language" size={18} color={colors.tint} />
            <Text style={[styles.langButtonText, { color: colors.tint }]}>{t.language}</Text>
          </Pressable>
        </View>
      </View>

      <LinearGradient
        colors={isDark ? [colors.tintLight, colors.tint] : [colors.tint, colors.tintLight]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.heroCard}
      >
        <View style={[styles.heroContent, isRTL && styles.rowReverse]}>
          <MaterialCommunityIcons name="palm-tree" size={44} color={colors.accentLight} />
          <View style={[styles.heroText, isRTL && { alignItems: "flex-end" }]}>
            <Text style={[styles.heroTitle, { color: colors.white }]}>{t.identifyTitle}</Text>
            <Text style={[styles.heroDescription, { color: colors.mint }, isRTL && styles.textRTL]}>{t.identifyDesc}</Text>
          </View>
        </View>
        <View style={[styles.heroActions, isRTL && styles.rowReverse]}>
          <Pressable
            style={({ pressed }) => [styles.heroButton, styles.cameraButton, { backgroundColor: colors.white }, pressed && { opacity: 0.85 }]}
            onPress={() => pickImage("camera")}
            disabled={isClassifying}
          >
            <Ionicons name="camera" size={20} color={colors.tint} />
            <Text style={[styles.heroButtonText, { color: colors.tint }]}>{t.camera}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.heroButton, styles.galleryButton, pressed && { opacity: 0.85 }]}
            onPress={() => pickImage("gallery")}
            disabled={isClassifying}
          >
            <Ionicons name="images" size={20} color={colors.white} />
            <Text style={[styles.heroButtonText, { color: colors.white }]}>{t.gallery}</Text>
          </Pressable>
        </View>
      </LinearGradient>

      {isClassifying && (
        <View style={[styles.classifyingBanner, { backgroundColor: colors.accentLight + "30" }, isRTL && styles.rowReverse]}>
          <ActivityIndicator size="small" color={colors.tint} />
          <Text style={[styles.classifyingText, { color: colors.tint }]}>{t.analyzing}</Text>
        </View>
      )}

      <View style={[styles.sessionsHeader, isRTL && styles.rowReverse]}>
        <Text style={[styles.sessionsTitle, { color: colors.text }, isRTL && styles.textRTL]}>{t.recentAnalyses}</Text>
        {sessions.length > 0 && (
          <Pressable onPress={confirmClearAll} style={({ pressed }) => [styles.clearAllButton, { backgroundColor: colors.error + "15" }, pressed && { opacity: 0.7 }]}>
            <Ionicons name="trash-outline" size={14} color={colors.error} />
            <Text style={[styles.clearAllText, { color: colors.error }]}>{t.clearAll}</Text>
          </Pressable>
        )}
      </View>

      {isLoading ? (
        <View style={styles.emptyState}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : sessions.length === 0 ? (
        <View style={styles.emptyState}>
          <MaterialCommunityIcons name="leaf" size={48} color={colors.accent} />
          <Text style={[styles.emptyTitle, { color: colors.text }, isRTL && styles.textRTL]}>{t.noAnalyses}</Text>
          <Text style={[styles.emptyText, { color: colors.textSecondary }, isRTL && styles.textRTL]}>{t.noAnalysesDesc}</Text>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderSession}
          contentContainerStyle={[styles.sessionsList, { paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 20) }]}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerTitleWrap: {
    flex: 1,
    marginRight: 8,
  },
  headerTitle: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
  },
  headerSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  langButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  langButtonText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  heroCard: {
    marginHorizontal: 20,
    marginTop: 16,
    borderRadius: 20,
    padding: 20,
  },
  heroContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  heroText: {
    flex: 1,
  },
  heroTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
  },
  heroDescription: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 4,
  },
  heroActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
  },
  heroButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  cameraButton: {},
  galleryButton: {
    backgroundColor: "rgba(255,255,255,0.2)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  heroButtonText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  classifyingBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginHorizontal: 20,
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 12,
  },
  classifyingText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  sessionsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    marginTop: 24,
    marginBottom: 8,
  },
  sessionsTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
  },
  clearAllButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  clearAllText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  sessionsList: {
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  sessionCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  sessionCardPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.98 }],
  },
  sessionIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  sessionInfo: {
    flex: 1,
  },
  sessionTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  sessionTime: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingBottom: 60,
  },
  emptyTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    marginTop: 8,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    paddingHorizontal: 40,
  },
  rowReverse: {
    flexDirection: "row-reverse",
  },
  textRTL: {
    textAlign: "right",
    writingDirection: "rtl",
  },
});
