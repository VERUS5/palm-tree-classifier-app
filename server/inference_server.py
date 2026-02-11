import os
import io
import base64
import logging
from flask import Flask, request, jsonify
from flask_cors import CORS
import torch
import torch.nn.functional as F
from torchvision.models import convnext_small
from torchvision import transforms
from PIL import Image

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

CLASSES = ["Khalas", "Razeez", "Shishi"]
MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")
NUM_FOLDS = 5

models = []

transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])


def remap_state_dict(state_dict):
    new_state = {}
    for k, v in state_dict.items():
        if k == "classifier.2.1.weight":
            new_state["classifier.2.weight"] = v
        elif k == "classifier.2.1.bias":
            new_state["classifier.2.bias"] = v
        else:
            new_state[k] = v
    return new_state


def load_models():
    global models
    models = []
    for fold in range(1, NUM_FOLDS + 1):
        model_path = os.path.join(MODELS_DIR, f"convnext_small_fold{fold}_best.pth")
        if not os.path.exists(model_path):
            logger.warning(f"Model file not found: {model_path}")
            continue

        logger.info(f"Loading fold {fold} from {model_path}...")
        model = convnext_small(num_classes=len(CLASSES))
        state_dict = torch.load(model_path, map_location="cpu", weights_only=False)
        remapped = remap_state_dict(state_dict)
        model.load_state_dict(remapped)
        model.eval()
        models.append(model)
        logger.info(f"Fold {fold} loaded successfully")

    logger.info(f"Loaded {len(models)} model folds for ensemble prediction")


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "models_loaded": len(models),
        "classes": CLASSES,
    })


@app.route("/predict", methods=["POST"])
def predict():
    if not models:
        return jsonify({"error": "No models loaded"}), 503

    data = request.get_json()
    if not data or "base64" not in data:
        return jsonify({"error": "No image provided"}), 400

    try:
        b64 = data["base64"]
        if "," in b64:
            b64 = b64.split(",")[1]

        img_bytes = base64.b64decode(b64)
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        tensor = transform(img).unsqueeze(0)

        all_probs = []
        with torch.no_grad():
            for model in models:
                logits = model(tensor)
                probs = F.softmax(logits, dim=1)
                all_probs.append(probs)

        avg_probs = torch.stack(all_probs).mean(dim=0).squeeze()
        confidence, pred_idx = torch.max(avg_probs, dim=0)

        per_class = {CLASSES[i]: round(avg_probs[i].item(), 4) for i in range(len(CLASSES))}

        return jsonify({
            "class": CLASSES[pred_idx.item()],
            "confidence": round(confidence.item(), 4),
            "probabilities": per_class,
            "folds_used": len(models),
        })

    except Exception as e:
        logger.error(f"Prediction error: {e}", exc_info=True)
        return jsonify({"error": f"Prediction failed: {str(e)}"}), 500


if __name__ == "__main__":
    load_models()
    port = int(os.environ.get("INFERENCE_PORT", 5001))
    logger.info(f"Starting inference server on port {port}")
    app.run(host="0.0.0.0", port=port, debug=False)
