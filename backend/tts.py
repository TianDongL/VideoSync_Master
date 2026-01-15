import sys
import os
import torch
import soundfile as sf
import traceback
import json


# Import local indextts package from backend/indextts
# Ensure backend directory is in path (it usually is if running from backend)
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.append(BACKEND_DIR)

try:
    from indextts.infer_v2 import IndexTTS2
except ImportError as e:
    print(f"Failed to import IndexTTS2: {e}")
    IndexTTS2 = None

# Default Checkpoint Paths
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
# 1. Dev: ../models/index-tts
PATH_DEV = os.path.join(BACKEND_DIR, "..", "models", "index-tts")
# 2. Prod: ../../models/index-tts
PATH_PROD = os.path.join(BACKEND_DIR, "..", "..", "models", "index-tts")

if os.path.exists(PATH_PROD):
    DEFAULT_MODEL_DIR = PATH_PROD
else:
    DEFAULT_MODEL_DIR = PATH_DEV
    
DEFAULT_CONFIG_PATH = os.path.join(DEFAULT_MODEL_DIR, "config.yaml")

def run_tts(text, ref_audio_path, output_path, model_dir=None, config_path=None, language="English"):
    """
    Run Voice Cloning TTS.
    :param text: Text to speak.
    :param ref_audio_path: Path to reference audio (3-10s).
    :param output_path: Where to save the result.
    :param model_dir: Path to model checkpoints.
    :param config_path: Path to config.yaml.
    :param language: Target language (Chinese, English, Japanese, Korean)
    """
    if IndexTTS2 is None:
        print("IndexTTS2 not available.")
        return False
    
    if model_dir is None:
        model_dir = DEFAULT_MODEL_DIR
    if config_path is None:
        config_path = DEFAULT_CONFIG_PATH
        
    print(f"Initializing IndexTTS2 from {model_dir}...")
    
    # Prepend language tag
    # Prepend language tag (DISABLED per user request: model doesn't support tags)
    # lang_map = {
    #     "Chinese": "<|zh|>",
    #     "English": "<|en|>",
    #     "Japanese": "<|jp|>",
    #     "Korean": "<|ko|>",
    #     "zh": "<|zh|>",
    #     "en": "<|en|>",
    #     "ja": "<|jp|>",
    #     "jp": "<|jp|>",
    #     "ko": "<|ko|>",
    # }
    # tag = lang_map.get(language, "<|en|>") # Default to english if unknown
    
    # If text already starts with a tag, don't double add? 
    # Actually, user input won't have it.
    # But just in case text came from somewhere else.
    # if not text.startswith("<|"):
    #     text = tag + " " + text
    
    print(f"TTS Text with tag: {text}")
    
    try:
        # Initialize the model
        # Note: adjust use_fp16/use_cuda_kernel/use_deepspeed based on environment.
        # Starting with conservative defaults (False) for stability. User can enable later.
        tts = IndexTTS2(
            cfg_path=config_path, 
            model_dir=model_dir, 
            use_fp16=False, 
            use_cuda_kernel=False, 
            use_deepspeed=False
        )
        
        print(f"Synthesizing text: '{text}' using ref: {ref_audio_path}")
        
        # infer returns None, saves to output_path. 
        # But we should check if output_path is absolute or relative.
        # It's better to ensure directory exists.
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        
        tts.infer(
            spk_audio_prompt=ref_audio_path, 
            text=text, 
            output_path=output_path,
            verbose=True
        )
        
        print(f"TTS complete. Saved to {output_path}")
        return True
        
    except Exception as e:
        print(f"Error during TTS: {e}")
        import traceback
        traceback.print_exc()
        return False

def run_batch_tts(tasks, model_dir=None, config_path=None, language="English"):
    """
    Run Batch Voice Cloning TTS.
    :param tasks: List of dicts {text, ref_audio_path, output_path}
    :param language: Default language for tasks if not specified in task item
    """
    if IndexTTS2 is None:
        print("IndexTTS2 not available.")
        return []

    if model_dir is None:
        model_dir = DEFAULT_MODEL_DIR
    if config_path is None:
        config_path = DEFAULT_CONFIG_PATH

    print(f"Initializing IndexTTS2 (Batch) from {model_dir}...")
    
    try:
        # Initialize model once
        tts = IndexTTS2(
            cfg_path=config_path, 
            model_dir=model_dir, 
            use_fp16=False, 
            use_cuda_kernel=False, 
            use_deepspeed=False
        )
        
        total = len(tasks)
        
        for i, task in enumerate(tasks):
            text = task['text']
            ref = task['ref_audio_path']
            out = task['output_path']
            
            # Use task-specific language or fallback to global default
            task_lang = task.get('language', language)
            
            # lang_map = {
            #     "Chinese": "<|zh|>",
            #     "English": "<|en|>",
            #     "Japanese": "<|jp|>",
            #     "Korean": "<|ko|>",
            #     "zh": "<|zh|>",
            #     "en": "<|en|>",
            #     "ja": "<|jp|>",
            #     "jp": "<|jp|>",
            #     "ko": "<|ko|>",
            # }
            # tag = lang_map.get(task_lang, "<|en|>")
            # # Fix typo: "<|en|>"
            # # Also handle potential 'Cantonese' if requested later, but for now strict map.
            # tag = lang_map.get(task_lang, "<|en|>")

            # if not text.startswith("<|"):
            #     text = tag + " " + text

            print(f"Synthesizing [{i+1}/{total}]: '{text}'")
            
            os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
            
            try:
                tts.infer(
                    spk_audio_prompt=ref, 
                    text=text, 
                    output_path=out,
                    verbose=False
                )
                
                # Emit Partial Result for UI to enable playback immediately
                partial_data = {
                    "index": task.get('index', i),
                    "audio_path": out,
                    "success": True
                }
                print(f"[PARTIAL] {json.dumps(partial_data)}", flush=True)
                
                yield {"success": True, "output": out}

            except Exception as e:
                print(f"Failed task {i}: {e}")
                
                partial_data = {
                    "index": task.get('index', i),
                    "success": False,
                    "error": str(e)
                }
                print(f"[PARTIAL] {json.dumps(partial_data)}", flush=True)
                
                yield {"success": False, "error": str(e)}
            
            # Emit progress (mapping 20% to 100% of global, or just 0-100 local?)
            # Backend usually emits 0-100 for the specific action.
            print(f"[PROGRESS] {int((i + 1) / total * 100)}", flush=True)

    except Exception as e:
        print(f"Error during Batch TTS: {e}")
        import traceback
        traceback.print_exc()
        # No yield here as we can't continue loop
        pass
