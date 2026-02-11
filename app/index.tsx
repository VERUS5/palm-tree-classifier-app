import React, { useState, useCallback, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  FlatList,
  Alert,
  ActivityIndicator,
  Platform,
  Animated as RNAnimated,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import Colors from "@/constants/colors";
import { getApiUrl } from "@/lib/query-client";

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

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
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
        Alert.alert("Permission needed", "Camera access is required to take photos.");
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
        Alert.alert("Permission needed", "Photo library access is required.");
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
        Alert.alert("Error", "Could not read the image data. Please try again.");
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
        }),
      });

      if (!classifyRes.ok) {
        const errText = await classifyRes.text();
        console.error("Classify response:", errText);
        throw new Error("Classification failed");
      }

      const classification: ClassificationResult = await classifyRes.json();

      const sessionRes = await fetch(`${baseUrl}api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          treeClass: classification.class,
          imageData: null,
          title: classification.isPalm
            ? `${classification.class} Palm (${Math.round(classification.confidence * 100)}%)`
            : "Unidentified Image",
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
      Alert.alert("Error", "Failed to analyze the image. Please try again.");
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
    Alert.alert("Delete Session", "Are you sure you want to delete this chat?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteSession(id) },
    ]);
  };

  const renderSession = ({ item }: { item: Session }) => {
    const iconName = treeIcons[item.treeClass || ""] || "help-circle-outline";
    const date = new Date(item.createdAt);
    const timeStr = date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    return (
      <Pressable
        style={({ pressed }) => [styles.sessionCard, pressed && styles.sessionCardPressed]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push({ pathname: "/chat/[id]", params: { id: item.id.toString(), treeClass: item.treeClass || "" } });
        }}
        onLongPress={() => confirmDelete(item.id)}
      >
        <View style={[styles.sessionIcon, { backgroundColor: item.treeClass ? Colors.light.accentLight + "40" : Colors.light.surfaceSecondary }]}>
          <Ionicons
            name={iconName as any}
            size={22}
            color={item.treeClass ? Colors.light.forest : Colors.light.textSecondary}
          />
        </View>
        <View style={styles.sessionInfo}>
          <Text style={styles.sessionTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.sessionTime}>{timeStr}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={Colors.light.textSecondary} />
      </Pressable>
    );
  };

  const webTopInset = Platform.OS === "web" ? 67 : 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Palm Assistant</Text>
          <Text style={styles.headerSubtitle}>Identify and learn about date palms</Text>
        </View>
      </View>

      <LinearGradient
        colors={[Colors.light.forest, Colors.light.tintLight]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.heroCard}
      >
        <View style={styles.heroContent}>
          <MaterialCommunityIcons name="palm-tree" size={44} color={Colors.light.accentLight} />
          <View style={styles.heroText}>
            <Text style={styles.heroTitle}>Identify a Palm Tree</Text>
            <Text style={styles.heroDescription}>Take a photo or choose from your gallery</Text>
          </View>
        </View>
        <View style={styles.heroActions}>
          <Pressable
            style={({ pressed }) => [styles.heroButton, styles.cameraButton, pressed && { opacity: 0.85 }]}
            onPress={() => pickImage("camera")}
            disabled={isClassifying}
          >
            <Ionicons name="camera" size={20} color={Colors.light.forest} />
            <Text style={styles.heroButtonText}>Camera</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.heroButton, styles.galleryButton, pressed && { opacity: 0.85 }]}
            onPress={() => pickImage("gallery")}
            disabled={isClassifying}
          >
            <Ionicons name="images" size={20} color={Colors.light.white} />
            <Text style={[styles.heroButtonText, { color: Colors.light.white }]}>Gallery</Text>
          </Pressable>
        </View>
      </LinearGradient>

      {isClassifying && (
        <View style={styles.classifyingBanner}>
          <ActivityIndicator size="small" color={Colors.light.forest} />
          <Text style={styles.classifyingText}>Analyzing your image...</Text>
        </View>
      )}

      <View style={styles.sessionsHeader}>
        <Text style={styles.sessionsTitle}>Recent Analyses</Text>
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
          <Text style={styles.emptyTitle}>No analyses yet</Text>
          <Text style={styles.emptyText}>Take a photo of a palm tree to get started</Text>
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
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textSecondary,
    marginTop: 2,
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
    color: Colors.light.forest,
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
    color: Colors.light.forest,
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
});
