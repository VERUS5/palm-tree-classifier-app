import streamlit as st
import torch
import torch.nn as nn
import torchvision.transforms as transforms
from PIL import Image
import timm
import numpy as np
import os
import google.generativeai as genai

# -----------------------------------------------------------------------------
# Configuration & Setup
# -----------------------------------------------------------------------------
st.set_page_config(
    page_title="Smart Palm Tree Assistant",
    page_icon="🌴",
    layout="wide"
)

# Constants
MODEL_NAME = 'convnext_small'
NUM_CLASSES = 3
CLASSES = ["Khalas", "Razeez", "Shishi"]
MODELS_DIR = "models"
GEMINI_MODEL_VERSION = "gemini-2.5-flash" 

# Configure Gemini (Lazy init)
def configure_gemini(api_key):
    if api_key:
        genai.configure(api_key=api_key)

# -----------------------------------------------------------------------------
# Model & Inference Helpers
# -----------------------------------------------------------------------------

def create_convnext_small(num_classes, dropout_rate=0.6):
    """
    Helper to create the ConvNeXt model matching the training script.
    Inferred structure: Torchvision ConvNeXt Small with a Sequential(Dropout, Linear) head.
    """
    from torchvision import models
    model = models.convnext_small(weights=None)
    
    # Modify the classifier head to match checkpoint structure:
    # classifier[2] becomes a Sequential with Dropout and Linear
    # This leads to keys like 'classifier.2.0' (Dropout) and 'classifier.2.1.weight' (Linear)
    in_features = model.classifier[2].in_features
    model.classifier[2] = nn.Sequential(
        nn.Dropout(p=dropout_rate),
        nn.Linear(in_features, num_classes)
    )
    return model

@st.cache_resource
def load_models():
    """
    Loads all available ConvNeXt models from models/ directory.
    """
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    models_list = []
    
    # We expect 5 folds
    for i in range(1, 6):
        model_path = os.path.join(MODELS_DIR, f"{MODEL_NAME}_fold{i}_best.pth")
        
        if os.path.exists(model_path):
            try:
                # Initialize architecture
                model = create_convnext_small(NUM_CLASSES)
                
                # Load weights
                checkpoint = torch.load(model_path, map_location=device)
                if 'state_dict' in checkpoint:
                    model.load_state_dict(checkpoint['state_dict'])
                else:
                    model.load_state_dict(checkpoint)
                
                model.to(device)
                model.eval()
                models_list.append(model)
            except Exception as e:
                st.error(f"Failed to load {model_path}: {e}")
    
    if not models_list:
        st.error("No models found! Please ensure 'models/' directory contains .pth files.")
        
    return models_list, device

def preprocess_image(image):
    """
    Resizes and normalizes the image for ConvNeXt.
    Matches standard validation transforms: Resize(256) -> CenterCrop(224).
    """
    transform = transforms.Compose([
        transforms.Resize(256),
        transforms.CenterCrop(224),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], 
                             std=[0.229, 0.224, 0.225])
    ])
    return transform(image).unsqueeze(0)  # Add batch dimension

def predict_ensemble(image, models_list, device):
    """
    Performs inference using the ensemble of models with TTA (Horizontal Flip).
    Matches the user's evaluation script logic.
    """
    if not models_list:
        return "Unknown", 0.0

    img_tensor = preprocess_image(image).to(device)
    
    preds_stack = []
    
    with torch.no_grad():
        for model in models_list:
            # Use autocast if on cuda
            if device.type == 'cuda':
                autocast_ctx = torch.amp.autocast('cuda', enabled=True)
            else:
                import contextlib
                autocast_ctx = contextlib.nullcontext()

            with autocast_ctx:
                # 1. Standard Prediction
                out = model(img_tensor)
                preds_stack.append(torch.softmax(out, dim=1))
                
                # 2. TTA: Horizontal Flip
                img_flipped = torch.flip(img_tensor, [3])
                out_flip = model(img_flipped)
                preds_stack.append(torch.softmax(out_flip, dim=1))
    
    # Average all predictions from all models and TTA versions
    avg_pred = torch.stack(preds_stack).mean(dim=0)
    
    # Get class and confidence
    probs = avg_pred.cpu().numpy()[0]
    class_idx = np.argmax(probs)
    confidence = probs[class_idx]
    
    return CLASSES[class_idx], confidence

# -----------------------------------------------------------------------------
# RAG (Mock) Component
# -----------------------------------------------------------------------------

rag_knowledge_base = {
    "Khalas": {
        "irrigation": "Khalas palms require moderate irrigation. In summer, water 3-4 times a week. In winter, once a week is sufficient. Avoid waterlogging.",
        "harvest": "Harvest Khalas dates when they reach the 'Rutab' stage (half-ripe) for best texture, typically in late summer (August).",
        "pests": "Susceptible to Red Palm Weevil. Regular monitoring is essential. Use pheromone traps for early detection.",
        "general": "Khalas is one of the most popular premium date varieties in Saudi Arabia, known for its golden color and caramel-like taste."
    },
    "Razeez": {
        "irrigation": "Razeez is highly drought-tolerant but produces best with consistent moisture. Deep watering twice a week in summer is recommended.",
        "harvest": "Razeez dates are often harvested at the 'Tamr' stage (fully dried) as they have excellent storage capabilities.",
        "pests": "Generally resistant, but watch for Lesser Date Moth. Maintain clean ground cover to reduce infestation risks.",
        "general": "Razeez dates are famous for their soft texture and rich flavor. They are often used for making date syrup (Molasses)."
    },
    "Shishi": {
        "irrigation": "Shishi palms prefer sandy soil with good drainage. Water frequently but lightly during the flowering season.",
        "harvest": "Harvest season starts mid-season. The fruits have a distinct two-tone color before fully ripening.",
        "pests": "Prone to dust mites. Washing bunches with water spray can help reduce mite populations.",
        "general": "Shishi is a widely cultivated variety, easily examining by its slightly varying color at the 'Bisar' stage."
    },
    "Unknown": {
        "general": "I could not identify this palm tree with high confidence. Please try uploading a clearer image."
    }
}

def retrieve_context(class_name, user_query):
    """
    Retrieves relevant context based on key terms in the query.
    """
    data = rag_knowledge_base.get(class_name, rag_knowledge_base["Unknown"])
    query_lower = user_query.lower()
    
    if class_name == "Unknown":
        return data["general"]
        
    context_parts = []
    
    # Simple keyword matching for retrieval
    if "water" in query_lower or "irrigat" in query_lower:
        context_parts.append(f"**Irrigation Info:** {data.get('irrigation', 'N/A')}")
    
    if "harvest" in query_lower or "pick" in query_lower or "ripe" in query_lower:
        context_parts.append(f"**Harvest Info:** {data.get('harvest', 'N/A')}")
        
    if "pest" in query_lower or "bug" in query_lower or "disease" in query_lower:
        context_parts.append(f"**Pest Control:** {data.get('pests', 'N/A')}")
        
    # Always include general info if specific info wasn't requested or as fallback
    if not context_parts:
        context_parts.append(f"**General Info:** {data.get('general', 'N/A')}")
        
    return "\n\n".join(context_parts)

def get_gemini_response(class_name, context, user_query):
    """
    Generates a response using Google Gemini.
    """
    try:
        model = genai.GenerativeModel(GEMINI_MODEL_VERSION)
        
        prompt = f"""
        System: You are an agricultural expert specializing in Date Palms. 
        The user has uploaded an image identified as a '{class_name}' palm tree.
        
        Relevant Context from Knowledge Base:
        {context}
        
        User Question: {user_query}
        
        Answer the user's question kindly and professionally, using the context provided. 
        If the context doesn't answer the question, give generic expert advice but mention you are using general knowledge.
        """
        
        response = model.generate_content(prompt)
        return response.text
    except Exception as e:
        return f"Error communicating with Gemini: {e}"

# -----------------------------------------------------------------------------
# UI Layout
# -----------------------------------------------------------------------------

# -----------------------------------------------------------------------------
# UI Strings & Language
# -----------------------------------------------------------------------------
STRINGS = {
    "en": {
        "title": "🌴 Smart Palm Tree Assistant",
        "header_about": "About",
        "about_text": """
        **Smart Palm Tree Assistant**
        
        This app uses an **Ensemble of ConvNeXt Models** to classify palm tree types (Khalas, Razeez, Shishi) from images.
        
        It features:
        -   **Computer Vision**: Deep Learning for classification.
        -   **RAG**: Retrieval-Augmented Generation for specific agricultural advice.
        -   **LLM**: Google Gemini for natural language interaction.
        """,
        "settings": "Settings",
        "api_key_help": "Enter your Google Gemini API Key",
        "warning_api": "Please enter your API Key to use the Chat feature.",
        "upload_label": "Choose an image...",
        "analysis_header": "Analysis",
        "loading_models": "Loading models...",
        "identify_btn": "Identify Tree",
        "analyzing": "Analyzing image...",
        "prediction_res": "Prediction Result",
        "confidence": "Confidence",
        "chat_header": "💬 Chat about your Tree",
        "chat_placeholder": "Ask about irrigation, harvest, pests...",
        "consulting": "Consulting agricultural records...",
        "suggested": "Suggested Questions:",
        "q_water": "How much water does it need?",
        "q_harvest": "When is the harvest season?",
        "q_pests": "Common pests for this tree?",
        "model_info": "Using Model: ",
        "lang_select": "Language"
    },
    "ar": {
        "title": "🌴 مساعد النخيل الذكي",
        "header_about": "عن التطبيق",
        "about_text": """
        **مساعد النخيل الذكي**
        
        يستخدم هذا التطبيق **نماذج ConvNeXt** لتصنيف أنواع أشجار النخيل (خلاص، رزيز، شيشي) من الصور.
        
        المميزات:
        -   **الرؤية الحاسوبية**: تعلم عميق للتصنيف.
        -   **RAG**: استرجاع المعلومات للنصائح الزراعية.
        -   **LLM**: جوجل جيمناي للمحادثة الذكية.
        """,
        "settings": "الإعدادات",
        "api_key_help": "أدخل مفتاح API الخاص بـ Google Gemini",
        "warning_api": "الرجاء إدخال مفتاح API لاستخدام ميزة الدردشة.",
        "upload_label": "اختر صورة...",
        "analysis_header": "التحليل",
        "loading_models": "جاري تحميل النماذج...",
        "identify_btn": "التعرف على الشجرة",
        "analyzing": "جاري تحليل الصورة...",
        "prediction_res": "نتيجة التوقع",
        "confidence": "نسبة الثقة",
        "chat_header": "💬 دردش حول شجرتك",
        "chat_placeholder": "اسأل عن الري، الحصاد، الآفات...",
        "consulting": "جاري استشارة السجلات الزراعية...",
        "suggested": "أسئلة مقترحة:",
        "q_water": "كم كمية الماء التي تحتاجها؟",
        "q_harvest": "متى موسم الحصاد؟",
        "q_pests": "ما هي الآفات الشائعة؟",
        "model_info": "النموذج المستخدم: ",
        "lang_select": "اللغة / Language"
    }
}

def main():
    # Sidebar
    with st.sidebar:
        # Language Selector
        lang_code = st.radio("Language / اللغة", ["English", "العربية"], index=0)
        lang = "en" if lang_code == "English" else "ar"
        t = STRINGS[lang]
        
        st.divider()
        st.header(t["settings"])
        api_key = st.text_input("Gemini API Key", type="password", help=t["api_key_help"])
        if api_key:
            configure_gemini(api_key)
        else:
             st.warning(t["warning_api"])

        st.divider()
        st.header(t["header_about"])
        st.markdown(t["about_text"])
        st.info(f"{t['model_info']}{GEMINI_MODEL_VERSION}")

    # Layout Direction
    if lang == "ar":
        st.markdown("""
        <style>
        .stApp { direction: rtl; }
        .stMarkdown { text-align: right; }
        p, h1, h2, h3 { text-align: right; }
        </style>
        """, unsafe_allow_html=True)

    # Main Content
    st.title(t["title"])
    
    uploaded_file = st.file_uploader(t["upload_label"], type=["jpg", "jpeg", "png"])

    # Session State helpers
    if "predicted_class" not in st.session_state:
        st.session_state.predicted_class = None
    if "messages" not in st.session_state:
        st.session_state.messages = []
    
    # Callback to handle button clicks for questions
    def submit_suggested(question):
        st.session_state.messages.append({"role": "user", "content": question})
        # We need to trigger the response generation immediately, which we do below by checking history

    if uploaded_file is not None:
        image = Image.open(uploaded_file).convert("RGB")
        
        col1, col2 = st.columns([1, 2])
        with col1:
            st.image(image, use_container_width=True)
        
        with col2:
            st.subheader(t["analysis_header"])
            
            with st.spinner(t["loading_models"]):
                models, device = load_models()
            
            if models:
                if st.button(t["identify_btn"], type="primary") or st.session_state.predicted_class is None:
                    with st.spinner(t["analyzing"]):
                        pred_class, conf = predict_ensemble(image, models, device)
                        st.session_state.predicted_class = pred_class
                        st.session_state.confidence = conf
                        
                if st.session_state.predicted_class:
                    # BIG Prediction Result
                    st.markdown(f"<h1 style='color: #4CAF50;'>{st.session_state.predicted_class}</h1>", unsafe_allow_html=True)
                    st.progress(float(st.session_state.confidence))
                    st.caption(f"{t['confidence']}: {st.session_state.confidence:.2%}")
            else:
                st.error("Could not load models.")

    # Chat Interface
    if st.session_state.predicted_class:
        st.markdown("---")
        st.subheader(t["chat_header"])
        
        # Display chat history
        for message in st.session_state.messages:
            with st.chat_message(message["role"]):
                st.markdown(message["content"])

        # Input logic checks
        user_input = st.chat_input(t["chat_placeholder"])
        
        # Suggested questions buttons
        st.write(t["suggested"])
        b1, b2, b3 = st.columns(3)
        if b1.button(t["q_water"]):
            user_input = t["q_water"]
        if b2.button(t["q_harvest"]):
             user_input = t["q_harvest"]
        if b3.button(t["q_pests"]):
             user_input = t["q_pests"]
             
        if user_input:
            # Append User Message
            if not any(m["content"] == user_input and m["role"] == "user" for m in st.session_state.messages[-1:]): 
                st.session_state.messages.append({"role": "user", "content": user_input})
                with st.chat_message("user"):
                    st.markdown(user_input)

            # Generate Response
            with st.chat_message("assistant"):
                with st.spinner(t["consulting"]):
                    context = retrieve_context(st.session_state.predicted_class, user_input)
                    response = get_gemini_response(st.session_state.predicted_class, context, user_input)
                    st.markdown(response)
            
            st.session_state.messages.append({"role": "assistant", "content": response})
            st.rerun()

if __name__ == "__main__":
    main()
