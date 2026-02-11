import React, { createContext, useContext, useState, useMemo, ReactNode, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { I18nManager } from "react-native";

export type Language = "ar" | "en";

const LANG_KEY = "palm_classifier_lang";

const strings = {
  ar: {
    appName: "مصنف النخيل",
    subtitle: "تعرّف على أنواع النخيل واحصل على نصائح زراعية",
    identifyTitle: "تصنيف نخلة",
    identifyDesc: "التقط صورة أو اختر من المعرض",
    camera: "الكاميرا",
    gallery: "المعرض",
    analyzing: "جاري تحليل الصورة...",
    recentAnalyses: "التحليلات الأخيرة",
    noAnalyses: "لا توجد تحليلات بعد",
    noAnalysesDesc: "التقط صورة نخلة للبدء",
    deleteSession: "حذف المحادثة",
    deleteConfirm: "هل أنت متأكد من حذف هذه المحادثة؟",
    cancel: "إلغاء",
    delete: "حذف",
    permissionNeeded: "صلاحية مطلوبة",
    cameraPermission: "يجب السماح بالوصول للكاميرا لالتقاط الصور.",
    galleryPermission: "يجب السماح بالوصول لمكتبة الصور.",
    imageError: "تعذر قراءة بيانات الصورة. حاول مرة أخرى.",
    classifyError: "فشل تحليل الصورة. حاول مرة أخرى.",
    error: "خطأ",
    identified: "تم التعرف",
    palmAssistant: "مساعد النخيل",
    askPlaceholder: "اسأل عن نخلتك...",
    askAnything: "اسأل أي سؤال",
    askAnythingDesc: "يمكنني المساعدة في الري والحصاد ومكافحة الآفات والمزيد",
    suggestedWater: "كم تحتاج من الماء؟",
    suggestedHarvest: "متى موسم الحصاد؟",
    suggestedPests: "ما الآفات الشائعة؟",
    suggestedFertilizer: "ما السماد المناسب؟",
    errorResponse: "عذراً، حدث خطأ. حاول مرة أخرى.",
    palm: "نخلة",
    unidentified: "صورة غير محددة",
    confidence: "الثقة",
    language: "English",
    models: "النماذج",
    knowledgeBase: "قاعدة المعرفة",
  },
  en: {
    appName: "Palm Classifier",
    subtitle: "Identify palm tree varieties and get farming advice",
    identifyTitle: "Identify a Palm Tree",
    identifyDesc: "Take a photo or choose from your gallery",
    camera: "Camera",
    gallery: "Gallery",
    analyzing: "Analyzing your image...",
    recentAnalyses: "Recent Analyses",
    noAnalyses: "No analyses yet",
    noAnalysesDesc: "Take a photo of a palm tree to get started",
    deleteSession: "Delete Session",
    deleteConfirm: "Are you sure you want to delete this chat?",
    cancel: "Cancel",
    delete: "Delete",
    permissionNeeded: "Permission needed",
    cameraPermission: "Camera access is required to take photos.",
    galleryPermission: "Photo library access is required.",
    imageError: "Could not read the image data. Please try again.",
    classifyError: "Failed to analyze the image. Please try again.",
    error: "Error",
    identified: "Identified",
    palmAssistant: "Palm Assistant",
    askPlaceholder: "Ask about your palm tree...",
    askAnything: "Ask me anything",
    askAnythingDesc: "I can help with irrigation, harvesting, pest control, and more",
    suggestedWater: "How should I water this tree?",
    suggestedHarvest: "When is the harvest season?",
    suggestedPests: "What pests should I watch for?",
    suggestedFertilizer: "What fertilizer does it need?",
    errorResponse: "Sorry, I encountered an error. Please try again.",
    palm: "Palm",
    unidentified: "Unidentified Image",
    confidence: "Confidence",
    language: "العربية",
    models: "Models",
    knowledgeBase: "Knowledge Base",
  },
};

interface I18nContextValue {
  lang: Language;
  t: (typeof strings)["en"];
  isRTL: boolean;
  toggleLanguage: () => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Language>("ar");

  useEffect(() => {
    AsyncStorage.getItem(LANG_KEY).then((saved) => {
      if (saved === "en" || saved === "ar") setLang(saved);
    });
  }, []);

  const toggleLanguage = () => {
    const next = lang === "ar" ? "en" : "ar";
    setLang(next);
    AsyncStorage.setItem(LANG_KEY, next);
  };

  const value = useMemo(
    () => ({
      lang,
      t: strings[lang],
      isRTL: lang === "ar",
      toggleLanguage,
    }),
    [lang]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
