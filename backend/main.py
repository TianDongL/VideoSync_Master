import sys
import os
import argparse

# Force UTF-8 for stdout/stderr
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

# Redirect stdout to capture noise? No, better to patch print.
# But libraries might write to C-level stdout.
# We will use markers __JSON_START__ to help frontend parse.
# And we ensure our prints go to flush=True.

import subprocess

# Ensure current directory is in sys.path so pyarmor_runtime can be found
current_script_dir = os.path.dirname(os.path.abspath(__file__))
if current_script_dir not in sys.path:
    sys.path.insert(0, current_script_dir)

# --- LOGGING & ENVIRONMENT SETUP ---
# Determine Environment (Dev vs Prod)
# Prod structure: App/resources/backend/main.py (Folder 'resources' is parent of backend)
# Dev structure: Project/backend/main.py
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR_NAME = os.path.basename(os.path.dirname(CURRENT_DIR))

if PARENT_DIR_NAME.lower() == 'resources':
    # Production / Packaged
    IS_PROD = True
    APP_ROOT = os.path.abspath(os.path.join(CURRENT_DIR, "..", ".."))
else:
    # Development
    IS_PROD = False
    APP_ROOT = os.path.abspath(os.path.join(CURRENT_DIR, ".."))

# Logging to "logs" folder in App Root (or Project Root)
log_dir = os.path.join(APP_ROOT, "logs")
log_file = os.path.join(log_dir, "backend_debug.log")

try:
    if not os.path.exists(log_dir):
        os.makedirs(log_dir, exist_ok=True)
        
    def debug_log(msg):
        try:
            with open(log_file, "a", encoding="utf-8") as f:
                import datetime
                ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                f.write(f"[{ts}] {msg}\n")
        except:
            print(f"Log Error: {msg}")

    debug_log("Backend starting...")
    debug_log(f"Executable: {sys.executable}")
    debug_log(f"CWD: {os.getcwd()}")
    debug_log(f"App Root: {APP_ROOT}")
    debug_log(f"Is Prod: {IS_PROD}")

except Exception as e:
    print(f"Logging setup failed: {e}")
    # Fallback logger
    def debug_log(msg):
        print(f"[LOG_FAIL] {msg}")

def exception_hook(exc_type, exc_value, exc_traceback):
    import traceback
    error_msg = "".join(traceback.format_exception(exc_type, exc_value, exc_traceback))
    try:
        debug_log(f"UNHANDLED EXCEPTION:\n{error_msg}")
    except:
        pass
    sys.__excepthook__(exc_type, exc_value, exc_traceback)

sys.excepthook = exception_hook



if not getattr(sys, 'frozen', False):
    try:
        current_dir = os.path.dirname(os.path.abspath(__file__))
        portable_python = os.path.join(current_dir, "python", "python.exe")
        
        if os.path.exists(portable_python):
            # Normalize paths for comparison
            target_py = os.path.abspath(portable_python).lower()
            current_py = sys.executable.lower()
            
            if target_py != current_py:
                print(f"[BOOTSTRAP] Relaunching with portable python: {target_py}")
                # Ensure we pass all original arguments
                cmd = [target_py, __file__] + sys.argv[1:]
                
                # Pass environment but ensure PATH includes python Scripts/Lib (optional, but good)
                env = os.environ.copy()
                
                # Execute
                ret = subprocess.call(cmd, env=env)
                sys.exit(ret)
                
    except Exception as e:
        print(f"[BOOTSTRAP WARNING] Failed to enforce portable python: {e}")
# ---------------------------

# Check for --model_dir in sys.argv early to set HF env vars before imports
# Redirect stdout/stderr to log file for capturing crash/errors in detached mode
# (Keep original stdout for JSON communication if needed, but for debugging we need visibility)
# We will use a custom writer that writes to both file and original stream
class DualWriter:
    def __init__(self, file_path, original_stream):
        self.file = open(file_path, "a", encoding="utf-8", buffering=1)
        self.original_stream = original_stream

    def write(self, message):
        try:
            self.file.write(message)
            self.original_stream.write(message)
            self.original_stream.flush()
        except:
            pass

    def flush(self):
        try:
            self.file.flush()
            self.original_stream.flush()
        except:
            pass

if log_file:
    sys.stdout = DualWriter(log_file, sys.stdout)
    sys.stderr = DualWriter(log_file, sys.stderr)

# ... (Logging setup done) ...

if not getattr(sys, 'frozen', False):
    # (Portable python check kept as is)
    pass

# Check for --model_dir in sys.argv
MODELS_HUB_DIR = None
if "--model_dir" in sys.argv:
    try:
        idx = sys.argv.index("--model_dir")
        if idx + 1 < len(sys.argv):
            MODELS_HUB_DIR = os.path.abspath(sys.argv[idx + 1])
    except:
        pass

if not MODELS_HUB_DIR:
    # Search for models in common locations
    possible_paths = [
        os.path.join(APP_ROOT, "models", "index-tts", "hub"),  # User installed in Root
        os.path.join(APP_ROOT, "resources", "models", "index-tts", "hub"), # User copied to resources
        os.path.join(CURRENT_DIR, "..", "models", "index-tts", "hub") # Dev / Default
    ]
    
    print(f"[DEBUG] APP_ROOT detected as: {APP_ROOT}")
    print(f"[DEBUG] Checking model paths:")
    
    for p in possible_paths:
        exists = os.path.exists(p)
        content_len = len(os.listdir(p)) if exists else 0
        print(f"  - {p} (Exists: {exists}, Items: {content_len})")
        
        if exists:
            # Check if it actually has content (not just empty folder)
            if content_len > 0: 
                MODELS_HUB_DIR = p
                print(f"  [SELECTED] Found valid model dir at: {p}")
                break
    
    # Fallback if none found with content
    if not MODELS_HUB_DIR:
         print("  [WARNING] No valid model dir found in candidates. Defaulting to Root path.")
         MODELS_HUB_DIR = os.path.join(APP_ROOT, "models", "index-tts", "hub")

# 验证模型目录是否存在
if not os.path.exists(MODELS_HUB_DIR):
    print(f"错误: 模型目录不存在: {MODELS_HUB_DIR}", file=sys.stderr)
    print(f"请将 'models' 文件夹放在应用根目录: {APP_ROOT}", file=sys.stderr)
    # We exit here, which explains why user saw nothing happens
    # But now with DualWriter, it should show in log.
    sys.exit(1)

log_location = f"Models found at: {MODELS_HUB_DIR}"
print(log_location)

os.environ["HF_HOME"] = MODELS_HUB_DIR
os.environ["HF_HUB_CACHE"] = MODELS_HUB_DIR
# 禁用HuggingFace自动下载
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

# Setup Portable FFmpeg
# In prod, we bundle ffmpeg into the backend folder, so relative path is same
sys_frozen = getattr(sys, 'frozen', False)
backend_root = os.path.dirname(os.path.abspath(sys.executable)) if sys_frozen else os.path.dirname(os.path.abspath(__file__))
ffmpeg_bin = os.path.join(backend_root, "ffmpeg", "bin")

if os.path.exists(os.path.join(ffmpeg_bin, "ffmpeg.exe")):
    print(f"Using portable FFmpeg from: {ffmpeg_bin}")
    os.environ["PATH"] = ffmpeg_bin + os.pathsep + os.environ["PATH"]
else:
    print("Portable FFmpeg not found, using system PATH.")

from asr import run_asr
from tts import run_tts, run_batch_tts
from alignment import align_audio, merge_audios_to_video, get_audio_duration
from llm import LLMTranslator
import ffmpeg
import json
import shutil

def analyze_video(file_path):
    try:
        probe = ffmpeg.probe(file_path)
        video_stream = next((stream for stream in probe['streams'] if stream['codec_type'] == 'video'), None)
        audio_stream = next((stream for stream in probe['streams'] if stream['codec_type'] == 'audio'), None)
        
        info = {
            "format_name": probe['format'].get('format_name'),
            "duration": float(probe['format'].get('duration', 0)),
            "video_codec": video_stream['codec_name'] if video_stream else None,
            "audio_codec": audio_stream['codec_name'] if audio_stream else None,
            "width": int(video_stream['width']) if video_stream else 0,
            "height": int(video_stream['height']) if video_stream else 0,
        }
        return {"success": True, "info": info}
    except Exception as e:
        return {"success": False, "error": str(e)}

def transcode_video(input_path, output_path):
    print(f"Transcoding {input_path} to {output_path}...")
    try:
        stream = ffmpeg.input(input_path)
        stream = ffmpeg.output(stream, output_path, vcodec='libx264', acodec='aac', preset='fast', crf=23)
        ffmpeg.run(stream, overwrite_output=True, quiet=False)
        return {"success": True, "output": output_path}
    except ffmpeg.Error as e:
        err = e.stderr.decode() if e.stderr else str(e)
        print(f"Transcoding failed: {err}")
        return {"success": False, "error": err}
    except Exception as e:
        print(f"Transcoding failed: {e}")
        return {"success": False, "error": str(e)}

def translate_text(input_text_or_json, target_lang):
    """
    Translates text or a list of segments (JSON string).
    """
    translator = LLMTranslator()
    
    try:
        # Try to parse as JSON list of segments
        import json
        data = json.loads(input_text_or_json)
        
        if isinstance(data, list):
            print(f"Translating {len(data)} segments to {target_lang}...")
            translated_segments = []
            for idx, item in enumerate(data):
                original = item.get('text', '')
                if not original:
                    translated_segments.append(item)
                    continue
                    
                print(f"  [{idx+1}/{len(data)}] {original}")
                print(f"[PROGRESS] {int((idx + 1) / len(data) * 100)}", flush=True)
                trans = translator.translate(original, target_lang)
                
                # Stream partial result
                partial_data = {
                    "index": idx,
                    "text": trans if trans else original
                }
                print(f"[PARTIAL] {json.dumps(partial_data)}", flush=True)
                
                new_item = item.copy()
                new_item['text'] = trans if trans else original
                new_item['text'] = trans if trans else original
                translated_segments.append(new_item)
            
            translator.cleanup()
            return {"success": True, "segments": translated_segments}
        else:
            # Simple string
            trans = translator.translate(input_text_or_json, target_lang)
            translator.cleanup()
            return {"success": True, "text": trans}
            
    except json.JSONDecodeError:
        # Not JSON, treat as raw text
        # Not JSON, treat as raw text
        trans = translator.translate(input_text_or_json, target_lang)
        translator.cleanup()
        return {"success": True, "text": trans}
    except Exception as e:
        return {"success": False, "error": str(e)}

def dub_video(input_path, target_lang, output_path):
    print(f"Starting AI Dubbing for {input_path} -> {target_lang}", flush=True)
    
    # 1. Initialize LLM
    translator = LLMTranslator()
    
    # 2. Run ASR
    # 2. Run ASR
    print("Step 1/4: Running ASR...", flush=True)
    segments = run_asr(input_path) # List of {start, end, text}
    if not segments:
        return {"success": False, "error": "ASR failed or no speech detected."}
    
    # Setup segments dir in output folder (user requested structure: output/TIMESTAMP_NAME/segments)
    # output_path is usually .../video_dubbed.mp4
    # We want a directory based on the output filename or just a 'segments' folder next to it?
    # User said: @[output/1768052886831_1月8日] thus implies a directory.
    # If output_path is a file, we should make a sibling folder or use the parent if it's already a dedicated folder.
    # Let's assume output_path is the final video file. We'll create a folder named "{filename_no_ext}_segments".
    
    output_dir = os.path.dirname(output_path)
    basename = os.path.splitext(os.path.basename(output_path))[0]
    segments_dir = os.path.join(output_dir, f"{basename}_segments")
    
    print(f"DEBUG: Output Path: {output_path}")
    print(f"DEBUG: Segments Dir: {segments_dir}")
    print(f"DEBUG: Input Path: {input_path}")
    
    if os.path.exists(segments_dir):
        shutil.rmtree(segments_dir)
    os.makedirs(segments_dir)

    new_audio_segments = []
    result_segments = [] 
    
    # 3. Process Segments
    # NEW LOGIC: Separate Translation and TTS for VRAM Optimization
    
    # 3. Phase 1: Translation (Batch)
    print(f"Step 2: Translating {len(segments)} segments...", flush=True)
    
    # Store intermediate tasks
    tts_tasks = []
    
    for idx, seg in enumerate(segments):
        original_text = seg['text']
        start = seg['start']
        end = seg['end']
        duration = end - start
        
        print(f"  [{idx+1}/{len(segments)}] Translating: {original_text}")
        translated_text = translator.translate(original_text, target_lang)
        print(f"    -> {translated_text}")
        
        if not translated_text:
             print("    Skipping (Translation failed)")
             continue
             
        tts_tasks.append({
            "idx": idx,
            "translated_text": translated_text,
            "start": start,
            "duration": duration,
            "original_seg": seg
        })
        
    # CLEANUP LLM HERE
    print("Translation done. Releasing LLM VRAM...", flush=True)
    translator.cleanup()
    del translator
    
    # 4. Phase 2: TTS (Batch)
    print(f"Step 3: Cloning Voice for {len(tts_tasks)} segments...", flush=True)
    
    for item in tts_tasks:
        idx = item['idx']
        translated_text = item['translated_text']
        start = item['start']
        duration = item['duration']
        
        # B. Extract Reference Audio
        ref_clip_path = os.path.join(segments_dir, f"ref_{idx}.wav")
        try:
            (
                ffmpeg
                .input(input_path, ss=start, t=duration)
                .output(ref_clip_path, acodec='pcm_s16le', ac=1, ar=24000, loglevel="error")
                .run(overwrite_output=True)
            )
        except Exception as e:
            print(f"    Failed to extract ref audio: {e}")
            continue

        # C. TTS
        tts_output_path = os.path.join(segments_dir, f"tts_{idx}.wav")
        success = run_tts(translated_text, ref_clip_path, tts_output_path, language=target_lang)
        
        if success:
            # Check duration and align if necessary
            if duration > 0:
                try:
                    current_dur = get_audio_duration(tts_output_path)
                    if current_dur and current_dur > duration + 0.1:
                        print(f"    [DubVideo] Segment {idx} duration {current_dur:.2f}s > {duration:.2f}s. Aligning...")
                        temp_aligned = tts_output_path.replace('.wav', '_aligned_temp.wav')
                        if align_audio(tts_output_path, temp_aligned, duration):
                            try:
                                if os.path.exists(tts_output_path):
                                     os.remove(tts_output_path)
                                os.rename(temp_aligned, tts_output_path)
                                print(f"    [DubVideo] Aligned and overwritten: {tts_output_path}")
                            except Exception as e:
                                print(f"    [DubVideo] Failed to overwrite aligned file: {e}")
                except Exception as e:
                    print(f"    [DubVideo] Auto-align warning: {e}")

            new_audio_segments.append({
                'start': start,
                'path': tts_output_path
            })
            result_segments.append({
                "index": idx,
                "text": translated_text,
                "audio_path": tts_output_path
            })
            
            try:
                os.remove(ref_clip_path)
            except:
                pass
        
    # 4. Merge
    print("Step 4/4: Merging Video...")
    success = merge_audios_to_video(input_path, new_audio_segments, output_path)
    
    if success:
        return {
            "success": True, 
            "output": output_path, 
            "segments": result_segments # Return path info
        }
    else:
        return {"success": False, "error": "Merging failed."}


def main():
    parser = argparse.ArgumentParser(description="VideoSync Backend")
    parser.add_argument("--action", type=str, help="Action to perform: asr, tts, align, merge_video", default="test_asr")
    parser.add_argument("--input", type=str, help="Input file path or JSON string for complex inputs")
    parser.add_argument("--ref", type=str, help="Reference audio path for TTS")
    parser.add_argument("--output", type=str, help="Output path")
    parser.add_argument("--duration", type=float, help="Target duration in seconds for Alignment")
    parser.add_argument("--lang", type=str, help="Target language for translation/dubbing", default="English")
    parser.add_argument("--json", action="store_true", help="Output result as JSON")
    parser.add_argument("--text", type=str, help="Text to speak (for generate_single_tts)")
    parser.add_argument("--start", type=float, help="Start time in seconds (for generate_single_tts)", default=0.0)
    parser.add_argument("--model_dir", type=str, help="Path to models directory (HF_HOME)")
    args = parser.parse_args()

    result_data = None
    
    if args.action == "test_asr":
        if args.input:
            if not args.json:
                print(f"Testing ASR on {args.input}", flush=True)
            segments = run_asr(args.input)
            if args.json:
                result_data = segments
            else:
                for seg in segments:
                    print(f"[{seg['start']:.2f} -> {seg['end']:.2f}] {seg['text']}")
        else:
            print("Please provide --input to test ASR.")
            
    elif args.action == "test_tts":
         # ... (keep existing) ...
        if args.input and args.ref and args.output:
            if not args.json:
                print(f"Testing TTS.")
            target_lang = args.lang if args.lang else "English"
            success = run_tts(args.input, args.ref, args.output, language=target_lang)
            if args.json:
                result_data = {"success": success, "output": args.output}
        else:
            print("Usage: --action test_tts --input 'Text' --ref 'ref.wav' --output 'out.wav' --lang 'Japanese'")
            
    elif args.action == "test_align":
         # ... (keep existing) ...
        if args.input and args.output and args.duration:
            if not args.json:
                print(f"Testing Alignment.")
            success = align_audio(args.input, args.output, args.duration)
            if args.json:
                result_data = {"success": success, "output": args.output}
        else:
            print("Usage: --action test_align --input 'in.wav' --output 'out.wav' --duration 5.0")

    elif args.action == "merge_video":

        if args.input and args.ref and args.output:
            video_path = args.input
            json_path = args.ref
            output_path = args.output
            
            try:
                with open(json_path, 'r', encoding='utf-8') as f:
                    audio_segments = json.load(f)
                
                if not args.json:
                    print(f"Merging {len(audio_segments)} audio clips into {video_path}")

                # Pre-process segments to ensure they fit in their slots
                for i, seg in enumerate(audio_segments):
                    # We need start and end to define slot
                    if 'start' in seg and 'end' in seg and 'path' in seg:
                         target_duration = float(seg['end']) - float(seg['start'])
                         audio_path = seg['path']
                         
                         if os.path.exists(audio_path):
                             current_duration = get_audio_duration(audio_path)
                             if current_duration:
                                 # If audio is significantly longer than slot (e.g. > 0.1s diff), compress it.
                                 if current_duration > target_duration + 0.1:
                                     print(f"Segment {i} duration ({current_duration:.2f}s) exceeds slot ({target_duration:.2f}s). Aligning...")
                                     
                                     # Create aligned path
                                     aligned_path = audio_path.replace('.wav', '_aligned.wav')
                                     
                                     # Align (compress)
                                     if align_audio(audio_path, aligned_path, target_duration):
                                         # Update path in segment to point to aligned file
                                         audio_segments[i]['path'] = aligned_path
                                     else:
                                         print(f"Failed to align segment {i}, using original.")
                                 else:
                                     pass # Fits or is shorter
                             else:
                                 print(f"Could not get duration for {audio_path}")
                         else:
                             print(f"Audio file not found: {audio_path}")
                
                success = merge_audios_to_video(video_path, audio_segments, output_path)
                
                if args.json:
                    result_data = {"success": success, "output": output_path}
            except Exception as e:
                print(f"Error loading JSON or merging: {e}")
                if args.json:
                    result_data = {"success": False, "error": str(e)}
        else:
            print("Usage: --action merge_video --input video.mp4 --ref segments.json --output final.mp4")
    
    elif args.action == "analyze_video":
        if args.input:
            result_data = analyze_video(args.input)
            if not args.json:
                print(result_data)
        else:
             print("Please provide --input video path")

    elif args.action == "transcode_video":
        if args.input and args.output:
            result_data = transcode_video(args.input, args.output)
            if not args.json:
                print(result_data)
        else:
            print("Usage: --action transcode_video --input in.mp4 --output out.mp4")

    elif args.action == "dub_video":
        if args.input and args.output:
            target = args.lang if args.lang else "English"
            result_data = dub_video(args.input, target, args.output)
            if not args.json:
                print(result_data)
        else:
            print("Usage: --action dub_video --input video.mp4 --output dubbed.mp4 --lang 'Chinese'")
    
    elif args.action == "generate_single_tts":
        # Generate TTS for a single segment
        # Requires: --input (video), --output (segment audio path), --text (text to speak), --start, --duration, --lang
        if args.input and args.output:
            try:
                video_path = args.input
                output_audio = args.output
                text = getattr(args, 'text', None)
                start_time = getattr(args, 'start', 0.0)
                duration = args.duration if args.duration else 3.0
                target_lang = args.lang if args.lang else "English"
                
                if not text:
                    result_data = {"success": False, "error": "Missing --text argument"}
                else:
                    # 1. Extract reference audio
                    ref_clip_path = output_audio.replace('.wav', '_ref.wav')
                    try:
                        ffmpeg.input(video_path, ss=start_time, t=duration).output(
                            ref_clip_path, acodec='pcm_s16le', ac=1, ar=24000, loglevel="error"
                        ).run(overwrite_output=True)
                    except Exception as e:
                        result_data = {"success": False, "error": f"Failed to extract ref audio: {str(e)}"}
                        if args.json:
                            print(json.dumps(result_data))
                        return
                    
                    # 2. Use provided text directly (Do NOT re-translate, to respect user edits)
                    translated_text = text
                    
                    if not translated_text:
                        result_data = {"success": False, "error": "No text provided"}
                    else:
                        # 3. Generate TTS
                        success = run_tts(translated_text, ref_clip_path, output_audio, language=target_lang)
                        
                        # 4. Cleanup ref
                        try:
                            if os.path.exists(ref_clip_path):
                                os.remove(ref_clip_path)
                        except:
                            pass
                        
                        if success:
                            if duration > 0: 
                                try:
                                    current_dur = get_audio_duration(output_audio)
                                    if current_dur and current_dur > duration + 0.1:
                                        print(f"[SingleTTS] Duration {current_dur:.2f}s > {duration:.2f}s. Aligning...")
                                        temp_aligned = output_audio.replace('.wav', '_aligned_temp.wav')
                                        if align_audio(output_audio, temp_aligned, duration):
                                            import shutil
                                            shutil.move(temp_aligned, output_audio)
                                            print(f"[SingleTTS] Aligned and overwritten: {output_audio}")
                                        else:
                                            print("[SingleTTS] Alignment failed.")
                                except Exception as e:
                                    print(f"[SingleTTS] Warning: Auto-alignment failed: {e}")

                            result_data = {"success": True, "audio_path": output_audio, "text": translated_text}
                        else:
                            result_data = {"success": False, "error": "TTS generation failed"}
            except Exception as e:
                result_data = {"success": False, "error": str(e)}
        else:
            print("Usage: --action generate_single_tts --input video.mp4 --output segment.wav --text 'Hello' --start 0.5 --duration 2.5 --lang English")

    elif args.action == "translate_text":
        if args.input:
            target = args.lang if args.lang else "English"
            result_raw = translate_text(args.input, target)
            
            if isinstance(result_raw, dict):
                 result_data = result_raw
            else:
                 result_data = {"success": True, "text": result_raw}

            if not args.json:
                print(result_raw)
        else:
            print("Usage: --action translate_text --input 'Text or JSON' --lang 'Chinese'")

    elif args.action == "generate_batch_tts":
        if args.input and args.ref:
            try:
                video_path = args.input
                json_path = args.ref # Path to temporary json file containing segments
                
                with open(json_path, 'r', encoding='utf-8') as f:
                    segments = json.load(f)
                
                print(f"Batch generating TTS for {len(segments)} segments...")

                tasks = []

                work_dir = os.path.dirname(json_path)

                for i, seg in enumerate(segments):
                    text = seg.get('text', '')
                    start = float(seg.get('start', 0))
                    end = float(seg.get('end', 0))
                    duration = end - start
                    

                    extraction_duration = duration

                    if duration < 1.0: duration = 1.0 
                    ref_path = os.path.join(work_dir, f"ref_{i}_{start}.wav")
                    out_path = seg.get('audioPath') 
                    if not out_path:
                        out_path = os.path.join(work_dir, f"segment_{i}.wav")
                    
                    try:
                        ffmpeg.input(video_path, ss=start, t=extraction_duration).output(
                            ref_path, acodec='pcm_s16le', ac=1, ar=24000, loglevel="error"
                        ).run(overwrite_output=True)
                    except Exception as e:
                        print(f"Failed to extract ref for segment {i}: {e}")
                        continue
                    
                    tasks.append({
                        "text": text,
                        "ref_audio_path": ref_path,
                        "output_path": out_path,
                        "index": i
                    })
                
                # 2. Run Batch TTS
                # This keeps the model loaded
                print(f"Running TTS inference on {len(tasks)} items...")
                # Assuming batch TTS also needs language. We can pass the global language if relevant 
                # or let it default. But main.py doesn't seem to have explicit lang for batch unless we assume defaults.
                # Actually, `generate_batch_tts` didn't have a --lang arg in `main` parser explicitly checked above, 
                # but `args.lang` defaults to "English".
                target_lang = args.lang if args.lang else "English"
                batch_results = run_batch_tts(tasks, language=target_lang) 
                
                # 3. Cleanup Refs & Format Result
                final_results = []
                for i, res in enumerate(batch_results):
                    task = tasks[i]
                    # Clean ref
                    try: os.remove(task['ref_audio_path'])
                    except: pass
                    
                    if res['success']:
                        # Check alignment
                        try:
                            # We need target duration from original segment
                            # We stored 'index' in task. Retrieve segment from 'segments' list using index?
                            # Yes, segments[task['index']]
                            seg_idx = task['index']
                            if seg_idx < len(segments):
                                origin_seg = segments[seg_idx]
                                s_start = float(origin_seg.get('start', 0))
                                s_end = float(origin_seg.get('end', 0))
                                slot_dur = s_end - s_start
                                
                                audio_p = res['output']
                                print(f"[DEBUG] Checking segment {seg_idx}: Slot={slot_dur:.2f}s, Path={audio_p}")

                                if os.path.exists(audio_p) and slot_dur > 0:
                                    curr = get_audio_duration(audio_p)
                                    print(f"[DEBUG] Segment {seg_idx} Actual Duration: {curr}") # Check if None
                                    
                                    if curr and curr > slot_dur + 0.1:
                                        print(f"[BatchTTS] Segment {seg_idx} duration {curr:.2f}s > {slot_dur:.2f}s. Aligning...")
                                        temp_aligned = audio_p.replace('.wav', '_aligned_temp.wav')
                                        if align_audio(audio_p, temp_aligned, slot_dur):
                                            import shutil
                                            # Retry loop for windows file lock
                                            import time
                                            for _ in range(3):
                                                try:
                                                    shutil.move(temp_aligned, audio_p)
                                                    print(f"[BatchTTS] Aligned and overwritten: {audio_p}")
                                                    break
                                                except Exception as move_err:
                                                    print(f"[BatchTTS] Warning: Move failed {move_err}, retrying...")
                                                    time.sleep(0.5)
                                        else:
                                            print(f"[BatchTTS] align_audio returned False")
                                    else:
                                        print(f"[BatchTTS] Segment {seg_idx} fits ({curr} <= {slot_dur + 0.1})")
                                else:
                                    print(f"[DEBUG] Skip align: Exists={os.path.exists(audio_p)}, Slot={slot_dur}")
                        except Exception as e:
                            print(f"[BatchTTS] Auto-align warning: {e}")

                        final_results.append({
                            "index": task['index'],
                            "audio_path": res['output'],
                            "success": True
                        })
                    else:
                        final_results.append({
                            "index": task['index'],
                            "success": False,
                            "error": res.get('error')
                        })
                
                result_data = {"success": True, "results": final_results}

            except Exception as e:
                print(f"Batch TTS Error: {e}")
                import traceback
                traceback.print_exc()
                result_data = {"success": False, "error": str(e)}
        else:
            print("Usage: --action generate_batch_tts --input video.mp4 --ref segments.json")

    else:
        print(f"Unknown action: {args.action}")

    if args.json and result_data is not None:
        print("\n__JSON_START__")
        print(json.dumps(result_data))
        print("__JSON_END__")

    try:
        if args.action == 'asr':
            debug_log(f"Running ASR on: {args.input}")
            result_data = run_asr(args.input, args.model)
        elif args.action == 'translate_text':
             # ... (rest of logic handles exceptions internally, but good to catch top level)
             # Handled inside specific functions or below
             pass 
             
        # ... logic ...
        
        # We need to wrap the MAIN execution block (lines ~340+) not just the end.
        # Actually easier to use sys.excepthook for unhandled exceptions
    except Exception as e:
        debug_log(f"CRITICAL ERROR: {e}")
        import traceback
        debug_log(traceback.format_exc())
        raise e



if __name__ == "__main__":
    debug_log("Entering main block")
    main()
