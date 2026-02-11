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
import Colors from "@/constants/colors";
import { getApiUrl } from "@/lib/query-client";
import { useI18n } from "@/lib/i18n";

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
}

const treeIcons: Record<string, string> = {
  Khalas: "tree",
  Razeez: "tree-outline",
  Shishi: "leaf",
};

const treeNamesAr: Record<string, string> = {
  Khalas: "خلاص",
  Razeez: "رزيز",
  Shishi: "شيشي",
};

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { t, lang, isRTL, toggleLanguage } = useI18n();
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
        style={({ pressed }) => [styles.sessionCard, pressed && styles.sessionCardPressed, isRTL && styles.rowReverse]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push({ pathname: "/chat/[id]", params: { id: item.id.toString(), treeClass: item.treeClass || "" } });
        }}
        onLongPress={() => confirmDelete(item.id)}
      >
        <View style={[styles.sessionIcon, { backgroundColor: item.treeClass ? Colors.light.accentLight + "40" : Colors.light.surfaceSecondary }]}>
          <Ionicons name={iconName as any} size={22} color={item.treeClass ? Colors.light.tint : Colors.light.textSecondary} />
        </View>
        <View style={[styles.sessionInfo, isRTL && { alignItems: "flex-end" }]}>
          <Text style={[styles.sessionTitle, isRTL && styles.textRTL]} numberOfLines={1}>{item.title}</Text>
          <Text style={[styles.sessionTime, isRTL && styles.textRTL]}>{timeStr}</Text>
        </View>
        <Ionicons name={isRTL ? "chevron-back" : "chevron-forward"} size={18} color={Colors.light.textSecondary} />
      </Pressable>
    );
  };

  const webTopInset = Platform.OS === "web" ? 67 : 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
      <View style={[styles.header, isRTL && styles.rowReverse]}>
        <View style={isRTL ? { alignItems: "flex-end" } : undefined}>
          <Text style={[styles.headerTitle, isRTL && styles.textRTL]}>{t.appName}</Text>
          <Text style={[styles.headerSubtitle, isRTL && styles.textRTL]}>{t.subtitle}</Text>
        </View>
        <Pressable
          onPress={toggleLanguage}
          style={({ pressed }) => [styles.langButton, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="language" size={18} color={Colors.light.tint} />
          <Text style={styles.langButtonText}>{t.language}</Text>
        </Pressable>
      </View>

      <LinearGradient
        colors={[Colors.light.tint, Colors.light.tintLight]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.heroCard}
      >
        <View style={[styles.heroContent, isRTL && styles.rowReverse]}>
          <MaterialCommunityIcons name="palm-tree" size={44} color={Colors.light.accentLight} />
          <View style={[styles.heroText, isRTL && { alignItems: "flex-end" }]}>
            <Text style={[styles.heroTitle, isRTL && styles.textRTL]}>{t.identifyTitle}</Text>
            <Text style={[styles.heroDescription, isRTL && styles.textRTL]}>{t.identifyDesc}</Text>
          </View>
        </View>
        <View style={[styles.heroActions, isRTL && styles.rowReverse]}>
          <Pressable
            style={({ pressed }) => [styles.heroButton, styles.cameraButton, pressed && { opacity: 0.85 }]}
            onPress={() => pickImage("camera")}
            disabled={isClassifying}
          >
            <Ionicons name="camera" size={20} color={Colors.light.tint} />
            <Text style={styles.heroButtonText}>{t.camera}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.heroButton, styles.galleryButton, pressed && { opacity: 0.85 }]}
            onPress={() => pickImage("gallery")}
            disabled={isClassifying}
          >
            <Ionicons name="images" size={20} color={Colors.light.white} />
            <Text style={[styles.heroButtonText, { color: Colors.light.white }]}>{t.gallery}</Text>
          </Pressable>
        </View>
      </LinearGradient>

      {isClassifying && (
        <View style={[styles.classifyingBanner, isRTL && styles.rowReverse]}>
          <ActivityIndicator size="small" color={Colors.light.tint} />
          <Text style={styles.classifyingText}>{t.analyzing}</Text>
        </View>
      )}

      <View style={[styles.sessionsHeader, isRTL && styles.rowReverse]}>
        <Text style={[styles.sessionsTitle, isRTL && styles.textRTL]}>{t.recentAnalyses}</Text>
        {sessions.length > 0 && (
          <Text style={styles.sessionsCount}>{sessions.length}</Text>
        )}
      </View>

      {isLoading ? (
        <View style={styles.emptyState}>
          <ActivityIndicator size="large" color={Colors.light.accent} />
        </View>
      ) : sessions.length === 0 ? (
        <View style={styles.emptyState}>
          <MaterialCommunityIcons name="leaf" size={48} color={Colors.light.accent} />
          <Text style={[styles.emptyTitle, isRTL && styles.textRTL]}>{t.noAnalyses}</Text>
          <Text style={[styles.emptyText, isRTL && styles.textRTL]}>{t.noAnalysesDesc}</Text>
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
    backgroundColor: Colors.light.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
  },
  headerSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
    marginTop: 2,
  },
  langButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.light.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  langButtonText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.tint,
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
    color: Colors.light.white,
  },
  heroDescription: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.light.mint,
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
  cameraButton: {
    backgroundColor: Colors.light.white,
  },
  galleryButton: {
    backgroundColor: "rgba(255,255,255,0.2)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  heroButtonText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.tint,
  },
  classifyingBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginHorizontal: 20,
    marginTop: 12,
    paddingVertical: 12,
    backgroundColor: Colors.light.accentLight + "30",
    borderRadius: 12,
  },
  classifyingText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: Colors.light.tint,
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
    color: Colors.light.text,
  },
  sessionsCount: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.light.textSecondary,
    backgroundColor: Colors.light.surfaceSecondary,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    overflow: "hidden",
  },
  sessionsList: {
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  sessionCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.light.surface,
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
    color: Colors.light.text,
  },
  sessionTime: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
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
    color: Colors.light.text,
    marginTop: 8,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
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
