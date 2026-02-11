import torch
import os
import timm

model_path = "models/convnext_small_fold1_best.pth"

print(f"Inspecting: {model_path}")

try:
    # Load checkpoint
    checkpoint = torch.load(model_path, map_location='cpu')
    print(f"Type of checkpoint: {type(checkpoint)}")
    
    if isinstance(checkpoint, dict):
        print(f"Keys in checkpoint: {list(checkpoint.keys())}")
        
        state_dict = None
        if 'state_dict' in checkpoint:
            print("Found 'state_dict' key.")
            state_dict = checkpoint['state_dict']
        elif 'model' in checkpoint:
             print("Found 'model' key.")
             state_dict = checkpoint['model']
        else:
            print("Assuming checkpoint IS the state_dict.")
            state_dict = checkpoint
            
        if state_dict:
            print(f"First 5 keys in state_dict: {list(state_dict.keys())[:5]}")
            
            # Check against local model
            model = timm.create_model('convnext_small', pretrained=False, num_classes=3)
            model_keys = list(model.state_dict().keys())
            print(f"First 5 keys in current timm model: {model_keys[:5]}")
            
            # Check for prefix issues
            chk_key = list(state_dict.keys())[0]
            mod_key = model_keys[0]
            
            if chk_key.startswith('module.') and not mod_key.startswith('module.'):
                print("DETECTED: Checkpoint has 'module.' prefix (DataParallel), model does not.")
            elif not chk_key.startswith('module.') and mod_key.startswith('module.'):
                 print("DETECTED: Model has 'module.' prefix, checkpoint does not.")
            else:
                print("No obvious prefix mismatch on first key.")

    else:
        print("Checkpoint is not a dict. It might be a full model object.")

except Exception as e:
    print(f"Error loading: {e}")
