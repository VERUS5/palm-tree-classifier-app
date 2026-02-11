import google.generativeai as genai
import os

# You can hardcode the key here for testing since passing args is annoying in this environment
API_KEY = "[ENCRYPTION_KEY]" 

genai.configure(api_key=API_KEY)

print("Listing available models...")
try:
    for m in genai.list_models():
        if 'generateContent' in m.supported_generation_methods:
            print(f"- {m.name}")
except Exception as e:
    print(f"Error listing models: {e}")
