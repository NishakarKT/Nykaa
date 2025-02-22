import torch
import torchvision.models as models
import torchvision.transforms as transforms
from PIL import Image
import torch.nn as nn
import pandas as pd
import random

# Define class names for skin tone detection.
class_names = ['dark', 'light', 'mid_dark', 'mid_light']

# Load the MobileNetV2 model (customized for skin tone detection).
try:
    model = models.mobilenet_v2(pretrained=False)
    num_ftrs = model.classifier[1].in_features
    model.classifier = nn.Sequential(
        nn.Dropout(0.7),
        nn.Linear(num_ftrs, 50),
        nn.ReLU(),
        nn.Dropout(0.5),
        nn.Linear(50, 4)
    )
except Exception as e:
    raise RuntimeError(f"Error defining model architecture: {e}")

# Load model state dict and set model to eval mode.
try:
    model_path = 'trained_model.pth'
    state_dict = torch.load(model_path, map_location=torch.device('cpu'))
    model.load_state_dict(state_dict)
    model.eval()
except Exception as e:
    raise RuntimeError(f"Error loading model state dict from {model_path}: {e}")

# Define image transformations.
transform = transforms.Compose([
    transforms.Resize(224),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
])

def predict_skin_tone(image: Image.Image) -> str:
    try:
        if image.mode != "RGB":
            image = image.convert("RGB")
        image_tensor = transform(image).unsqueeze(0)
        with torch.no_grad():
            output = model(image_tensor)
            _, predicted = torch.max(output, 1)
        return class_names[predicted.item()]
    except Exception as e:
        raise RuntimeError(f"Error during skin tone prediction: {e}")

# Updated product recommendation data including Eyeshadow.
data = {
    "Skin Tone": ["light", "mid_light", "mid_dark", "dark"],
    "Lipstick": ["#FFC0CB", "#FF69B4", "#DB7093", "#C71585"],
    "Compact": ["#FFFACD", "#FAFAD2", "#FFEFD5", "#FFD700"],
    "Blush": ["#FFB6C1", "#FF1493", "#FF6347", "#DC143C"],
    "Eyeliner": ["#000000", "#111111", "#222222", "#333333"],
    "Eyeshadow": ["#660033", "#660033", "#660033", "#660033"],
    "Eyebrow": ["#3B2F2F", "#3B2F2F", "#3B2F2F", "#3B2F2F"]
}
df = pd.DataFrame(data)

def perturb_color(hex_color: str, variance: int = 15) -> str:
    # Convert hex to RGB, add random perturbation, then convert back.
    hex_color = hex_color.lstrip("#")
    r, g, b = [int(hex_color[i:i+2], 16) for i in (0, 2, 4)]
    def clamp(val): return max(0, min(255, val))
    r = clamp(r + random.randint(-variance, variance))
    g = clamp(g + random.randint(-variance, variance))
    b = clamp(b + random.randint(-variance, variance))
    return f"#{r:02X}{g:02X}{b:02X}"

def recommend_products(skin_tone: str) -> dict:
    try:
        idx = df[df["Skin Tone"] == skin_tone].index[0]
        recommendations = {
            "Lipstick": df.at[idx, "Lipstick"],
            "Eyeliner": df.at[idx, "Eyeliner"],
            "Eyeshadow": df.at[idx, "Eyeshadow"],
            "Eyebrow": df.at[idx, "Eyebrow"],
            "Blush": df.at[idx, "Blush"],
            "Foundation": df.at[idx, "Compact"]
        }
        return recommendations
    except Exception:
        return {}

def generate_filters(skin_tone: str, num_filters: int = 5) -> list:
    base = recommend_products(skin_tone)
    filters = []
    for _ in range(num_filters):
        filter_combo = {
            "Lipstick": perturb_color(base.get("Lipstick", "#FFFFFF")),
            "Eyeliner": perturb_color(base.get("Eyeliner", "#000000")),
            "Eyeshadow": perturb_color(base.get("Eyeshadow", "#660033")),
            "Eyebrow": perturb_color(base.get("Eyebrow", "#3B2F2F")),
            "Blush": perturb_color(base.get("Blush", "#FFB6C1")),
            "Foundation": perturb_color(base.get("Compact", "#FFFACD"))
        }
        filters.append(filter_combo)
    return filters
